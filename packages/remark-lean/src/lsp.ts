import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { remark } from "remark";
import remarkHtml from "remark-html";

export interface Token {
  line: number;
  start: number;
  length: number;
  type: string;
  groupId?: string;
  hoverText?: string;
}

export class LeanLSPClient {
  private proc: ChildProcess | null = null;
  private buffer = Buffer.alloc(0);
  private nextRequestId = 1;
  private pendingRequests = new Map<number, (res: any) => void>();
  private compileWaiters = new Map<string, () => void>();
  private legend: string[] = [];
  private cwd: string;
  private tempFileUri: string;

  constructor(private rootUri: string) {
    this.cwd = rootUri.startsWith("file://")
      ? fileURLToPath(rootUri)
      : rootUri;
    const fileId = Math.random().toString(36).substring(7);
    this.tempFileUri = `${this.rootUri}/__temp_remark_lean_${fileId}__.lean`;
  }

  async start(): Promise<void> {
    this.proc = spawn("lake", ["serve"], { cwd: this.cwd });

    this.proc.stdout!.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parseMessages();
    });

    this.proc.on("error", (err) => {
      console.error("Lean LSP Process Error:", err);
    });

    const initRes = await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          semanticTokens: {
            requests: { full: true },
            tokenTypes: [
              "keyword", "variable", "property", "function", "namespace",
              "type", "class", "enum", "interface", "struct",
              "typeParameter", "parameter", "enumMember", "event",
              "method", "macro", "modifier", "comment", "string",
              "number", "regexp", "operator", "decorator", "leanSorryLike"
            ],
            tokenModifiers: []
          }
        }
      }
    });

    this.legend = initRes.result?.capabilities?.semanticTokensProvider?.legend?.tokenTypes || [];
    this.sendNotification("initialized", {});
  }

  async highlight(
    content: string,
    options: { synchronizedHovers?: boolean; prependCode?: string } = {}
  ): Promise<string> {
    if (!this.proc) {
      await this.start();
    }

    let prependCode = options.prependCode || "";
    if (prependCode && !prependCode.endsWith("\n")) {
      prependCode += "\n";
    }
    const prependLines = (prependCode.match(/\n/g) || []).length;
    const fullContent = prependCode + content;

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: this.tempFileUri,
        languageId: "lean",
        version: 1,
        text: fullContent
      }
    });

    await Promise.race([
      new Promise<void>((resolve) => this.compileWaiters.set(this.tempFileUri, resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, 1500))
    ]);

    const tokensRes = await this.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: this.tempFileUri }
    });

    const data: number[] = tokensRes.result?.data || [];
    const tokens: Token[] = [];
    let currentLine = 0;
    let currentCol = 0;

    for (let i = 0; i < data.length; i += 5) {
      const deltaLine = data[i]!;
      const deltaStartChar = data[i + 1]!;
      const length = data[i + 2]!;
      const tokenTypeIndex = data[i + 3]!;
      
      currentLine += deltaLine;
      if (deltaLine > 0) {
        currentCol = deltaStartChar;
      } else {
        currentCol += deltaStartChar;
      }

      const type = this.legend[tokenTypeIndex] || "variable";
      if (currentLine >= prependLines) {
        tokens.push({
          line: currentLine - prependLines,
          start: currentCol,
          length,
          type
        });
      }
    }

    if (options.synchronizedHovers) {
      const tempFileName = this.tempFileUri.split("/").pop();
      const skipTypes = new Set(["keyword", "comment", "string", "number", "regexp", "operator", "modifier", "event", "leanSorryLike"]);
      const regex = /[a-zA-Z_α-ωΑ-Ω][a-zA-Z0-9_α-ωΑ-Ω']*/g;

      // Query document symbols to find containing declarations
      const symbolsRes = await this.sendRequest("textDocument/documentSymbol", {
        textDocument: { uri: this.tempFileUri }
      });
      const symbols: any[] = symbolsRes.result || [];

      interface MatchInfo {
        word: string;
        lineIndex: number;
        startChar: number;
        length: number;
        existingToken?: Token;
        defLine: number | null;
        defChar: number | null;
        defUri: string | null;
        hoverText: string;
      }

      const matches: MatchInfo[] = [];

      // Find skip ranges (comments, strings, char literals)
      const skipRanges: { start: number; end: number }[] = [];
      let skipMatch;

      // Line comments
      const lineCommentRegex = /--.*/g;
      while ((skipMatch = lineCommentRegex.exec(content)) !== null) {
        skipRanges.push({ start: skipMatch.index, end: skipMatch.index + skipMatch[0].length });
      }

      // Block comments
      const blockCommentRegex = /\/-[\s\S]*?-\//g;
      while ((skipMatch = blockCommentRegex.exec(content)) !== null) {
        skipRanges.push({ start: skipMatch.index, end: skipMatch.index + skipMatch[0].length });
      }

      // String literals
      const stringRegex = /"(\\.|[^"\\])*"/g;
      while ((skipMatch = stringRegex.exec(content)) !== null) {
        skipRanges.push({ start: skipMatch.index, end: skipMatch.index + skipMatch[0].length });
      }

      // Character literals
      const charRegex = /'(\\.|[^'\\])'/g;
      while ((skipMatch = charRegex.exec(content)) !== null) {
        skipRanges.push({ start: skipMatch.index, end: skipMatch.index + skipMatch[0].length });
      }

      // Helper to convert index in content to line and character
      const lineOffsets: number[] = [0];
      for (let i = 0; i < content.length; i++) {
        if (content[i] === "\n") {
          lineOffsets.push(i + 1);
        }
      }

      const getLineAndChar = (index: number) => {
        let line = 0;
        while (line + 1 < lineOffsets.length && lineOffsets[line + 1]! <= index) {
          line++;
        }
        const character = index - lineOffsets[line]!;
        return { line, character };
      };

      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(content)) !== null) {
        const word = match[0];
        const startPos = match.index;

        // Check if inside any skip range
        const isSkipped = skipRanges.some(r => startPos >= r.start && startPos < r.end);
        if (isSkipped) {
          continue;
        }

        const { line: lineIndex, character: startChar } = getLineAndChar(startPos);
        const length = word.length;

        // Check if there is an existing token covering this position that should be skipped
        const coveringToken = tokens.find(t => 
          t.line === lineIndex && 
          startChar >= t.start && 
          startChar < (t.start + t.length)
        );
        if (coveringToken && skipTypes.has(coveringToken.type)) {
          continue;
        }

        const existingToken = tokens.find(t => t.line === lineIndex && t.start === startChar);

        matches.push({
          word,
          lineIndex,
          startChar,
          length,
          existingToken,
          defLine: null,
          defChar: null,
          defUri: null,
          hoverText: ""
        });
      }

      // Query definition and hover for each match
      for (const m of matches) {
        // Query definition
        const defRes = await this.sendRequest("textDocument/definition", {
          textDocument: { uri: this.tempFileUri },
          position: { line: m.lineIndex + prependLines, character: m.startChar }
        });

        const defs: any[] = Array.isArray(defRes.result) 
          ? defRes.result 
          : (defRes.result ? [defRes.result] : []);

        if (defs.length > 0) {
          const def = defs[0];
          const uri = def.targetUri || def.uri;
          const range = def.targetSelectionRange || def.targetRange || def.range;
          
          if (uri && range) {
            m.defUri = uri;
            m.defLine = range.start.line;
            m.defChar = range.start.character;
          }
        }

        // Query hover
        const hoverRes = await this.sendRequest("textDocument/hover", {
          textDocument: { uri: this.tempFileUri },
          position: { line: m.lineIndex + prependLines, character: m.startChar }
        });
        const rawHover = extractHoverText(hoverRes);
        if (rawHover) {
          const compiled = await remark().use(remarkHtml).process(rawHover);
          m.hoverText = String(compiled);
        } else {
          m.hoverText = "";
        }
      }

      // Resolve groups
      for (const m of matches) {
        let groupId = "";
        if (m.defLine !== null && m.defChar !== null && m.defUri !== null) {
          if (tempFileName && m.defUri.endsWith(tempFileName)) {
            groupId = `ref-${m.defLine}-${m.defChar}`;
          } else {
            const uriHash = hashString(m.defUri);
            groupId = `ref-ext-${uriHash}-${m.defLine}-${m.defChar}`;
          }
        } else {
          // Fallback to document symbol-scoped auto-implicit/implicit logic
          const fullLine = m.lineIndex + prependLines;
          const containingSymbol = symbols.find(sym => {
            const start = sym.range.start.line;
            const end = sym.range.end.line;
            return fullLine >= start && fullLine <= end;
          });

          // Find all candidates: same word, no definition, same containing symbol (or both null)
          const candidates = matches.filter(o => 
            o.word === m.word &&
            o.defLine === null &&
            symbols.find(sym => {
              const start = sym.range.start.line;
              const end = sym.range.end.line;
              return (o.lineIndex + prependLines) >= start && (o.lineIndex + prependLines) <= end;
            })?.name === containingSymbol?.name
          );

          // Sort candidates by position
          candidates.sort((a, b) => {
            if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
            return a.startChar - b.startChar;
          });

          const first = candidates[0];
          if (first) {
            groupId = `ref-${first.lineIndex + prependLines}-${first.startChar}`;
          }
        }

        if (groupId || m.hoverText) {
          if (m.existingToken) {
            if (groupId) m.existingToken.groupId = groupId;
            if (m.hoverText) m.existingToken.hoverText = m.hoverText;
          } else {
            tokens.push({
              line: m.lineIndex,
              start: m.startChar,
              length: m.length,
              type: "variable",
              groupId,
              hoverText: m.hoverText
            });
          }
        }
      }
    }

    const lines = content.split("\n");
    const highlightedLines = lines.map((lineText, lineIndex) => {
      const lineTokens = tokens
        .filter((t) => t.line === lineIndex)
        .sort((a, b) => a.start - b.start);

      let html = "";
      let lastIndex = 0;
      for (const token of lineTokens) {
        if (token.start < lastIndex) continue;
        html += escapeHtml(lineText.substring(lastIndex, token.start));
        const tokenText = lineText.substring(token.start, token.start + token.length);
        
        let dataAttr = "";
        if (options.synchronizedHovers) {
          if (token.groupId) {
            dataAttr += ` data-symbol="${token.groupId}"`;
          }
          if (token.hoverText) {
            dataAttr += ` data-hover="${escapeHtml(token.hoverText)}"`;
          }
        }
        
        html += `<span class="lean-${token.type}"${dataAttr}>${escapeHtml(tokenText)}</span>`;
        lastIndex = token.start + token.length;
      }
      html += escapeHtml(lineText.substring(lastIndex));
      return html;
    });

    this.sendNotification("textDocument/didClose", {
      textDocument: { uri: this.tempFileUri }
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
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      const message = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
      this.proc!.stdin!.write(message);
    });
  }

  private sendNotification(method: string, params: any) {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    const message = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
    this.proc!.stdin!.write(message);
  }

  private parseMessages() {
    while (true) {
      const headerIndex = this.buffer.indexOf("\r\n\r\n");
      if (headerIndex === -1) break;

      const headerText = this.buffer.subarray(0, headerIndex).toString("ascii");
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

      const messageJson = this.buffer.subarray(messageStart, messageStart + contentLength).toString("utf8");
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
        }
      } catch (e) {
        console.error("Error parsing LSP message", e);
      }
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function extractHoverText(hoverRes: any): string {
  if (!hoverRes || !hoverRes.result) return "";
  const contents = hoverRes.result.contents;
  if (typeof contents === "string") {
    return contents;
  }
  if (contents && typeof contents === "object") {
    if ("value" in contents) {
      return contents.value;
    }
    if (Array.isArray(contents)) {
      return contents
        .map((c) => (typeof c === "string" ? c : c.value || ""))
        .filter(Boolean)
        .join("\n\n");
    }
  }
  return "";
}
