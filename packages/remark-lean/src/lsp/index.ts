import { spawn, execSync, type ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { remark } from "remark";
import remarkHtml from "remark-html";
import escapeHtml from "escape-html";

import {
  type Token,
  type DiscoveredToken,
  type GoalPosition,
  type DiagnosticPosition,
  parseSemanticTokens,
  extractQueryTokens,
  deduplicateDiscoveredTokens,
  getGoalQueryPositions,
  createAndSortLineEvents,
  extractHoverText,
  addTargetBlank,
  highlightGoalHtml,
  hashString,
} from "./lib";

export * from "./lib";

export class LeanLSPClient {
  private proc: ChildProcess | null = null;
  private initPromise: Promise<void> | null = null;
  private buffer = Buffer.alloc(0);
  private nextRequestId = 1;
  private pendingRequests = new Map<number, (res: any) => void>();
  private compileWaiters = new Map<string, () => void>();
  private diagnosticsMap = new Map<string, any[]>();
  private legend: string[] = [];

  constructor(private projectPath: string) {}

  start(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      this.proc = spawn("lake", ["serve"], { cwd: this.projectPath });

      this.proc.stdout!.on("data", (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.parseMessages();
      });

      this.proc.on("error", (err) => {
        console.error("Lean LSP Process Error:", err);
      });

      const initRes = await this.sendRequest("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(this.projectPath).href,
        capabilities: {
          textDocument: {
            semanticTokens: {
              requests: { full: true },
              tokenTypes: [
                "keyword",
                "variable",
                "property",
                "function",
                "namespace",
                "type",
                "class",
                "enum",
                "interface",
                "struct",
                "typeParameter",
                "parameter",
                "enumMember",
                "event",
                "method",
                "macro",
                "modifier",
                "comment",
                "string",
                "number",
                "regexp",
                "operator",
                "decorator",
                "leanSorryLike",
              ],
              tokenModifiers: [],
            },
          },
        },
      });

      this.legend =
        initRes.result?.capabilities?.semanticTokensProvider?.legend
          ?.tokenTypes || [];
      this.sendNotification("initialized", {});
    })();
    return this.initPromise;
  }

  async highlight(
    content: string,
    options: { synchronizedHovers?: boolean; prependCode?: string } = {}
  ): Promise<string> {
    if (!this.proc) {
      await this.start();
    }

    const wordMap = new Map<
      string,
      { type: string; groupId?: string; hoverText?: string; permalink?: string }
    >();
    const fileId = Math.random().toString(36).substring(7);
    const tempFilePath = path.join(this.projectPath, `__temp_remark_lean_${fileId}__.lean`);
    const tempFileUri = pathToFileURL(tempFilePath).href;

    let prependCode = options.prependCode || "";
    if (prependCode && !prependCode.endsWith("\n")) {
      prependCode += "\n";
    }
    const prependLines = (prependCode.match(/\n/g) || []).length;
    const fullContent = prependCode + content;

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: tempFileUri,
        languageId: "lean",
        version: 1,
        text: fullContent,
      },
    });

    await Promise.race([
      new Promise<void>((resolve) =>
        this.compileWaiters.set(tempFileUri, resolve)
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);

    const tokensRes = await this.sendRequest(
      "textDocument/semanticTokens/full",
      {
        textDocument: { uri: tempFileUri },
      }
    );

    const data: number[] = tokensRes.result?.data || [];
    const tokens = parseSemanticTokens(data, this.legend, prependLines);

    const lines = content.split("\n");

    if (options.synchronizedHovers) {
      const tempFileName = tempFileUri.split("/").pop();
      const queryTokens = extractQueryTokens(lines);

      const results = await Promise.all(
        queryTokens.map(async (qt) => {
          const [defRes, hoverRes] = await Promise.all([
            this.sendRequest("textDocument/definition", {
              textDocument: { uri: tempFileUri },
              position: {
                line: qt.line + prependLines,
                character: qt.startChar,
              },
            }).catch(() => null),
            this.sendRequest("textDocument/hover", {
              textDocument: { uri: tempFileUri },
              position: {
                line: qt.line + prependLines,
                character: qt.startChar,
              },
            }).catch(() => null),
          ]);
          return { qt, defRes, hoverRes };
        })
      );

      const discovered: DiscoveredToken[] = [];

      for (const { qt, defRes, hoverRes } of results) {
        let hoverText = "";
        let hoverRange: any = null;

        if (hoverRes && hoverRes.result) {
          hoverText = extractHoverText(hoverRes);
          if (hoverRes.result.range) {
            hoverRange = hoverRes.result.range;
          }
        }

        let defUri = null;
        let defLine = null;
        let defChar = null;

        if (defRes && defRes.result) {
          const defs: any[] = Array.isArray(defRes.result)
            ? defRes.result
            : [defRes.result];
          if (defs.length > 0) {
            const def = defs[0];
            const uri = def.targetUri || def.uri;
            const range =
              def.targetSelectionRange || def.targetRange || def.range;
            if (uri && range) {
              defUri = uri;
              defLine = range.start.line;
              defChar = range.start.character;
            }
          }
        }

        let permalink: string | undefined;
        if (defUri && defLine !== null) {
          const isLocal = defUri.includes("__temp_remark_lean_");
          if (!isLocal) {
            permalink = getPermalinkForUri(defUri, defLine);
          }
        }

        if (hoverText || defUri) {
          const startL = hoverRange
            ? hoverRange.start.line - prependLines
            : qt.line;
          const startC = hoverRange ? hoverRange.start.character : qt.startChar;
          const endL = hoverRange
            ? hoverRange.end.line - prependLines
            : qt.line;
          const endC = hoverRange
            ? hoverRange.end.character
            : qt.startChar + qt.length;

          discovered.push({
            startLine: startL,
            startChar: startC,
            endLine: endL,
            endChar: endC,
            defUri,
            defLine,
            defChar,
            hoverText,
            permalink,
          });
        }
      }

      const uniqueTokens = deduplicateDiscoveredTokens(discovered);

      for (const u of uniqueTokens) {
        if (u.hoverText) {
          const compiled = await remark().use(remarkHtml).process(u.hoverText);
          u.hoverText = addTargetBlank(String(compiled).trim());
        }
      }

      for (const ut of uniqueTokens) {
        let groupId = "";
        if (ut.defLine !== null && ut.defChar !== null && ut.defUri !== null) {
          if (ut.defUri.includes("__temp_remark_lean_")) {
            groupId = `ref-${ut.defLine}-${ut.defChar}`;
          } else {
            const uriHash = hashString(ut.defUri);
            groupId = `ref-ext-${uriHash}-${ut.defLine}-${ut.defChar}`;
          }
        }

        for (let l = ut.startLine; l <= ut.endLine; l++) {
          if (l < 0 || l >= lines.length) continue;
          const sChar = l === ut.startLine ? ut.startChar : 0;
          const eChar =
            l === ut.endLine ? ut.endChar : (lines[l] || "").length;

          if (eChar > sChar) {
            const existing = tokens.find(
              (t) =>
                t.line === l &&
                t.start === sChar &&
                t.length === eChar - sChar
            );
            const isDef = !!(
              tempFileName &&
              ut.defUri &&
              ut.defUri.endsWith(tempFileName) &&
              ut.defLine !== null &&
              ut.defLine - prependLines === l &&
              ut.defChar !== null &&
              ut.defChar >= sChar &&
              ut.defChar < eChar
            );
            if (existing) {
              if (groupId) existing.groupId = groupId;
              if (ut.hoverText) existing.hoverText = ut.hoverText;
              if (ut.permalink) existing.permalink = ut.permalink;
              if (isDef) existing.isDefinition = true;
            } else {
              tokens.push({
                line: l,
                start: sChar,
                length: eChar - sChar,
                type: "hover-span",
                groupId,
                hoverText: ut.hoverText,
                permalink: ut.permalink,
                isDefinition: isDef,
              });
            }

            const word = (lines[l] || "").substring(sChar, eChar);
            if (
              !wordMap.has(word) ||
              (ut.hoverText && !wordMap.get(word)?.hoverText)
            ) {
              wordMap.set(word, {
                type: existing ? existing.type : "hover-span",
                groupId,
                hoverText: ut.hoverText,
                permalink: ut.permalink,
              });
            }
          }
        }
      }

      for (const t of tokens) {
        if (t.hoverText) {
          t.hoverText = highlightGoalHtml(t.hoverText, wordMap);
        }
      }
    }
    const lineGoals = new Map<number, GoalPosition[]>();
    if (options.synchronizedHovers) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineText = lines[lineIndex] || "";
        if (!lineText.trim()) continue;

        // Find all query positions for this line
        const positions = getGoalQueryPositions(lineText);

        const rawGoalsList = await Promise.all(
          positions.map(async (pos) => {
            const goalRes = await this.sendRequest("$/lean/plainGoal", {
              textDocument: { uri: tempFileUri },
              position: { line: lineIndex + prependLines, character: pos },
            });

            if (goalRes && goalRes.result) {
              const rawGoal = goalRes.result.rendered || "";
              if (rawGoal) {
                const compiled = await remark()
                  .use(remarkHtml)
                  .process(rawGoal);
                const targetBlankHtml = addTargetBlank(
                  String(compiled).trim()
                );
                const finalHtml = highlightGoalHtml(targetBlankHtml, wordMap);
                return {
                  character: pos,
                  compiledHtml: finalHtml,
                };
              }
            }
            return null;
          })
        );
        const goalsList: GoalPosition[] = rawGoalsList.filter(
          (goal): goal is GoalPosition => goal !== null
        );

        if (goalsList.length > 0) {
          lineGoals.set(lineIndex, goalsList);
        }
      }
    }

    const diagnostics = this.diagnosticsMap.get(tempFileUri) || [];
    this.diagnosticsMap.delete(tempFileUri);

    const localDiagnostics = diagnostics.filter((d) => {
      const line = d.range.start.line - prependLines;
      return line >= 0 && line < lines.length;
    });

    const diagnosticsByLine = new Map<number, any[]>();
    for (const d of localDiagnostics) {
      const lineIndex = d.range.start.line - prependLines;
      if (!diagnosticsByLine.has(lineIndex)) {
        diagnosticsByLine.set(lineIndex, []);
      }
      diagnosticsByLine.get(lineIndex)!.push(d);
    }

    const lineDiagnostics = new Map<number, DiagnosticPosition[]>();
    if (options.synchronizedHovers) {
      for (const [lineIndex, diags] of diagnosticsByLine.entries()) {
        const lineText = lines[lineIndex] || "";
        const pos = lineText.length;

        // Determine highest severity
        const highestSeverity = Math.min(...diags.map((d) => d.severity));

        // Combine messages
        const combinedMessage = diags.map((d) => d.message).join("\n\n---\n\n");

        const markdownMessage = "```lean\n" + combinedMessage + "\n```";
        const compiled = await remark()
          .use(remarkHtml)
          .process(markdownMessage);
        const targetBlankHtml = addTargetBlank(String(compiled).trim());
        const finalHtml = highlightGoalHtml(targetBlankHtml, wordMap);

        lineDiagnostics.set(lineIndex, [
          {
            character: pos,
            severity: highestSeverity,
            message: combinedMessage,
            compiledHtml: finalHtml,
          },
        ]);
      }
    }

    const highlightedLines = lines.map((lineText, lineIndex) => {
      const lineTokens = tokens.filter((t) => t.line === lineIndex);

      const goals = lineGoals.get(lineIndex) || [];
      const diags = lineDiagnostics.get(lineIndex) || [];
      const events = createAndSortLineEvents(lineTokens, goals, diags);

      let html = "";
      let lastIndex = 0;

      for (const event of events) {
        if (event.index > lastIndex) {
          html += escapeHtml(lineText.substring(lastIndex, event.index));
          lastIndex = event.index;
        }

        if (event.kind === "start") {
          const token = event.data;
          let dataAttr = "";
          if (options.synchronizedHovers) {
            if (token.groupId) dataAttr += ` data-symbol="${token.groupId}"`;
            if (token.hoverText)
              dataAttr += ` data-hover="${escapeHtml(token.hoverText)}"`;
            if (token.permalink)
              dataAttr += ` data-permalink="${escapeHtml(token.permalink)}"`;
            if (token.isDefinition) dataAttr += ` data-is-definition="true"`;
          }

          const cls = token.type ? `lean-${token.type}` : "lean-hover-span";
          html += `<span class="${cls}"${dataAttr}>`;
        } else if (event.kind === "end") {
          html += `</span>`;
        } else if (event.kind === "goal") {
          const goal = event.data;
          html += `<span class="lean-goal-marker" data-hover="${escapeHtml(
            goal.compiledHtml
          )}">…</span>`;
        } else if (event.kind === "diagnostic") {
          const diag = event.data;
          const severityClass =
            diag.severity === 1
              ? "lean-diagnostic-error"
              : diag.severity === 2
              ? "lean-diagnostic-warning"
              : "lean-diagnostic-info";
          html += `<span class="lean-diagnostic-marker ${severityClass}" data-hover="${escapeHtml(
            diag.compiledHtml
          )}">…</span>`;
        }
      }

      if (lastIndex < lineText.length) {
        html += escapeHtml(lineText.substring(lastIndex));
      }

      return html;
    });

    this.sendNotification("textDocument/didClose", {
      textDocument: { uri: tempFileUri },
    });

    return highlightedLines.join("\n");
  }

  async shutdown(): Promise<void> {
    if (this.proc) {
      try {
        await this.sendRequest("shutdown", null);
        this.sendNotification("exit", {});
      } catch (e) {
        // process might have already exited
      }
      this.proc.kill();
      this.proc = null;
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
    const id = this.nextRequestId++;
    return new Promise((res) => {
      this.pendingRequests.set(id, res);
      // console.log(`sent req ${method}: ${JSON.stringify(params)}`)
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      const message = `Content-Length: ${Buffer.byteLength(
        payload,
        "utf8"
      )}\r\n\r\n${payload}`;
      this.proc!.stdin!.write(message);
    });
  }

  private sendNotification(method: string, params: any) {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    const message = `Content-Length: ${Buffer.byteLength(
      payload,
      "utf8"
    )}\r\n\r\n${payload}`;
    this.proc!.stdin!.write(message);
  }

  private parseMessages() {
    while (true) {
      const headerIndex = this.buffer.indexOf("\r\n\r\n");
      if (headerIndex === -1) break;

      const headerText = this.buffer
        .subarray(0, headerIndex)
        .toString("ascii");
      const contentLengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!contentLengthMatch || !contentLengthMatch[1]) {
        this.buffer = this.buffer.subarray(headerIndex + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerIndex + 4;
      if (this.buffer.length < messageStart + contentLength) {
        break;
      }

      const messageJson = this.buffer
        .subarray(messageStart, messageStart + contentLength)
        .toString("utf8");
      this.buffer = this.buffer.subarray(messageStart + contentLength);

      try {
        const msg = JSON.parse(messageJson);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const resolveFn = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          resolveFn!(msg);
        } else if (msg.method === "$/lean/fileProgress") {
          const { uri } = msg.params.textDocument;
          const processing = msg.params.processing;
          if (processing.length === 0) {
            const resolveFn = this.compileWaiters.get(uri);
            if (resolveFn) {
              this.compileWaiters.delete(uri);
              resolveFn();
            }
          }
        } else if (msg.method === "textDocument/publishDiagnostics") {
          const { uri, diagnostics } = msg.params;
          this.diagnosticsMap.set(uri, diagnostics);
        }
      } catch (e) {
        console.error("Error parsing LSP message", e);
      }
    }
  }
}

let leanVersion: string | null = null;
function getLeanVersion(): string {
  if (leanVersion !== null) return leanVersion;
  try {
    const output = execSync("lean --version", { encoding: "utf8" });
    const match = output.match(/version\s+([v0-9.]+)/i);
    if (match && match[1]) {
      leanVersion = match[1].startsWith("v") ? match[1] : `v${match[1]}`;
      return leanVersion;
    }
  } catch (e) {}
  leanVersion = "master";
  return leanVersion;
}

function getPermalinkForUri(uri: string, line: number): string | undefined {
  // Convert backslashes to forward slashes for unified regex matching
  const normalizedUri = uri.replace(/\\/g, "/");

  // 1. Check if it is a standard library file (matches "/src/lean/" followed by Init, Lean, Std, or lake)
  const stdlibMatch = normalizedUri.match(
    /\/src\/lean\/((?:Init|Lean|Std|lake)\/.+)$/i
  );
  if (stdlibMatch) {
    const relativePath = stdlibMatch[1];

    // Attempt to extract version from elan toolchain folder name first
    let version = "master";
    const elanMatch = normalizedUri.match(
      /\/toolchains\/([^/#?]+)\/src\/lean\//i
    );
    if (elanMatch && elanMatch[1]) {
      const folderName = elanMatch[1];
      if (folderName.includes("---")) {
        version = folderName.split("---").pop()!;
      } else if (folderName.includes(":")) {
        version = folderName.split(":").pop()!;
      } else {
        version = folderName;
      }
    } else {
      // Fallback to active Lean compiler version
      version = getLeanVersion();
    }

    return `https://github.com/leanprover/lean4/blob/${version}/src/${relativePath}#L${
      line + 1
    }`;
  }

  // 2. Check local git repositories (separate packages)
  try {
    const filePath = fileURLToPath(uri);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) return undefined;

    // Check if it's inside a git repository
    const isGit = execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (isGit === "true") {
      const gitRoot = execSync("git rev-parse --show-toplevel", {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      const remoteUrl = execSync("git config --get remote.origin.url", {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      if (remoteUrl) {
        let cleanedUrl = remoteUrl.trim();
        if (cleanedUrl.endsWith(".git")) {
          cleanedUrl = cleanedUrl.slice(0, -4);
        }
        const githubRegex = /github\.com[:\/]([^\/]+)\/(.+)$/i;
        const match = cleanedUrl.match(githubRegex);
        if (match) {
          const owner = match[1];
          const repo = match[2];
          const githubUrl = `https://github.com/${owner}/${repo}`;

          // Get commit SHA
          const commit = execSync("git rev-parse HEAD", {
            cwd: dir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();

          // Get relative path of the file from the git root
          const relativePath = path
            .relative(gitRoot, filePath)
            .replace(/\\/g, "/");

          return `${githubUrl}/blob/${commit}/${relativePath}#L${line + 1}`;
        }
      }
    }
  } catch (e) {
    // If any git command fails, just ignore and return undefined
  }
  return undefined;
}
