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
  private initPromise: Promise<void> | null = null;
  private buffer = Buffer.alloc(0);
  private nextRequestId = 1;
  private pendingRequests = new Map<number, (res: any) => void>();
  private compileWaiters = new Map<string, () => void>();
  private legend: string[] = [];
  private cwd: string;
  private currentWordMap = new Map<string, { type: string; groupId?: string; hoverText?: string }>();

  constructor(private rootUri: string) {
    this.cwd = rootUri.startsWith("file://")
      ? fileURLToPath(rootUri)
      : rootUri;
  }

  start(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
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

    const fileId = Math.random().toString(36).substring(7);
    const tempFileUri = `${this.rootUri}/__temp_remark_lean_${fileId}__.lean`;

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
        text: fullContent
      }
    });

    await Promise.race([
      new Promise<void>((resolve) => this.compileWaiters.set(tempFileUri, resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, 1500))
    ]);

    const tokensRes = await this.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: tempFileUri }
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

    const lines = content.split("\n");

    if (options.synchronizedHovers) {
      const tempFileName = tempFileUri.split("/").pop();
      const tokenizeRegex = /[a-zA-Z_α-ωΑ-Ω0-9']+|[^\s]/g;

      interface QueryToken {
        line: number;
        startChar: number;
        length: number;
        word: string;
      }

      const queryTokens: QueryToken[] = [];
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineText = lines[lineIndex];
        if (!lineText) continue;

        let match;
        tokenizeRegex.lastIndex = 0;
        while ((match = tokenizeRegex.exec(lineText)) !== null) {
          queryTokens.push({
            line: lineIndex,
            startChar: match.index,
            length: match[0].length,
            word: match[0]
          });
        }
      }

      const results = await Promise.all(
        queryTokens.map(async (qt) => {
          const [defRes, hoverRes] = await Promise.all([
            this.sendRequest("textDocument/definition", {
              textDocument: { uri: tempFileUri },
              position: { line: qt.line + prependLines, character: qt.startChar }
            }).catch(() => null),
            this.sendRequest("textDocument/hover", {
              textDocument: { uri: tempFileUri },
              position: { line: qt.line + prependLines, character: qt.startChar }
            }).catch(() => null)
          ]);
          return { qt, defRes, hoverRes };
        })
      );

      interface DiscoveredToken {
        startLine: number;
        startChar: number;
        endLine: number;
        endChar: number;
        defUri: string | null;
        defLine: number | null;
        defChar: number | null;
        hoverText: string;
      }

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
          const defs: any[] = Array.isArray(defRes.result) ? defRes.result : [defRes.result];
          if (defs.length > 0) {
            const def = defs[0];
            const uri = def.targetUri || def.uri;
            const range = def.targetSelectionRange || def.targetRange || def.range;
            if (uri && range) {
              defUri = uri;
              defLine = range.start.line;
              defChar = range.start.character;
            }
          }
        }

        if (hoverText || defUri) {
          const startL = hoverRange ? hoverRange.start.line - prependLines : qt.line;
          const startC = hoverRange ? hoverRange.start.character : qt.startChar;
          const endL = hoverRange ? hoverRange.end.line - prependLines : qt.line;
          const endC = hoverRange ? hoverRange.end.character : qt.startChar + qt.length;

          discovered.push({
            startLine: startL,
            startChar: startC,
            endLine: endL,
            endChar: endC,
            defUri,
            defLine,
            defChar,
            hoverText
          });
        }
      }

      const uniqueTokens: DiscoveredToken[] = [];
      for (const d of discovered) {
        const existing = uniqueTokens.find(u => 
          u.startLine === d.startLine && u.startChar === d.startChar &&
          u.endLine === d.endLine && u.endChar === d.endChar
        );
        if (existing) {
          if (!existing.hoverText && d.hoverText) existing.hoverText = d.hoverText;
          if (!existing.defUri && d.defUri) {
            existing.defUri = d.defUri;
            existing.defLine = d.defLine;
            existing.defChar = d.defChar;
          }
        } else {
          uniqueTokens.push(d);
        }
      }

      for (const u of uniqueTokens) {
        if (u.hoverText) {
          const compiled = await remark().use(remarkHtml).process(u.hoverText);
          u.hoverText = addTargetBlank(String(compiled).trim());
        }
      }

      const wordMap = new Map<string, { type: string; groupId?: string; hoverText?: string }>();

      for (const ut of uniqueTokens) {
        let groupId = "";
        if (ut.defLine !== null && ut.defChar !== null && ut.defUri !== null) {
          if (tempFileName && ut.defUri.endsWith(tempFileName)) {
            groupId = `ref-${ut.defLine}-${ut.defChar}`;
          } else {
            const uriHash = hashString(ut.defUri);
            groupId = `ref-ext-${uriHash}-${ut.defLine}-${ut.defChar}`;
          }
        }

        for (let l = ut.startLine; l <= ut.endLine; l++) {
          if (l < 0 || l >= lines.length) continue;
          const sChar = (l === ut.startLine) ? ut.startChar : 0;
          const eChar = (l === ut.endLine) ? ut.endChar : (lines[l] || "").length;
          
          if (eChar > sChar) {
            const existing = tokens.find(t => t.line === l && t.start === sChar && t.length === (eChar - sChar));
            if (existing) {
              if (groupId) existing.groupId = groupId;
              if (ut.hoverText) existing.hoverText = ut.hoverText;
            } else {
              tokens.push({
                line: l,
                start: sChar,
                length: eChar - sChar,
                type: "hover-span",
                groupId,
                hoverText: ut.hoverText
              });
            }

            const word = (lines[l] || "").substring(sChar, eChar);
            if (!wordMap.has(word) || (ut.hoverText && !wordMap.get(word)?.hoverText)) {
              wordMap.set(word, { type: existing ? existing.type : "hover-span", groupId, hoverText: ut.hoverText });
            }
          }
        }
      }

      for (const t of tokens) {
        if (t.hoverText) {
          t.hoverText = highlightGoalHtml(t.hoverText, wordMap);
        }
      }

      this.currentWordMap = wordMap;
    }
    interface GoalPosition {
      character: number;
      compiledHtml: string;
    }
    const lineGoals = new Map<number, GoalPosition[]>();
    if (options.synchronizedHovers) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineText = lines[lineIndex] || "";
        if (!lineText.trim()) continue;

        // Find all query positions for this line
        let cleanText = lineText;
        const commentIndex = cleanText.indexOf("--");
        if (commentIndex !== -1) {
          cleanText = cleanText.substring(0, commentIndex);
        }
        cleanText = cleanText.trimEnd();

        const positions: number[] = [];
        const regex = /<;>|;/g;
        let match;
        while ((match = regex.exec(cleanText)) !== null) {
          let pos = match.index;
          while (pos > 0 && /\s/.test(cleanText[pos - 1]!)) {
            pos--;
          }
          if (pos > 0 && !positions.includes(pos)) {
            positions.push(pos);
          }
        }

        if (!cleanText.endsWith("<;>") && !cleanText.endsWith(";")) {
          positions.push(cleanText.length);
        }

        const goalsList: GoalPosition[] = [];
        for (const pos of positions) {
          const goalRes = await this.sendRequest("$/lean/plainGoal", {
            textDocument: { uri: tempFileUri },
            position: { line: lineIndex + prependLines, character: pos }
          });

          if (goalRes && goalRes.result) {
            const rawGoal = goalRes.result.rendered || "";
            if (rawGoal) {
              const compiled = await remark().use(remarkHtml).process(rawGoal);
              const targetBlankHtml = addTargetBlank(String(compiled).trim());
              const finalHtml = highlightGoalHtml(targetBlankHtml, this.currentWordMap);
              goalsList.push({
                character: pos,
                compiledHtml: finalHtml
              });
            }
          }
        }

        if (goalsList.length > 0) {
          lineGoals.set(lineIndex, goalsList);
        }
      }
    }

    const highlightedLines = lines.map((lineText, lineIndex) => {
      const lineTokens = tokens.filter((t) => t.line === lineIndex);

      const events: { index: number; kind: 'start' | 'end' | 'goal'; data: any; length?: number; id?: number }[] = [];

      for (let i = 0; i < lineTokens.length; i++) {
        const token = lineTokens[i]!;
        events.push({ index: token.start, kind: 'start', data: token, length: token.length, id: i });
        events.push({ index: token.start + token.length, kind: 'end', data: token, length: token.length, id: i });
      }

      const goals = lineGoals.get(lineIndex) || [];
      for (const goal of goals) {
        events.push({ index: goal.character, kind: 'goal', data: goal });
      }

      events.sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index;
        
        if (a.kind === 'goal' && b.kind !== 'goal') return -1;
        if (b.kind === 'goal' && a.kind !== 'goal') return 1;

        if (a.kind === 'end' && b.kind === 'start') return -1;
        if (a.kind === 'start' && b.kind === 'end') return 1;

        if (a.kind === 'start' && b.kind === 'start') {
          if (a.length !== b.length) return b.length! - a.length!;
          return a.id! - b.id!;
        }
        if (a.kind === 'end' && b.kind === 'end') {
          if (a.length !== b.length) return a.length! - b.length!;
          return b.id! - a.id!;
        }

        return 0;
      });

      let html = "";
      let lastIndex = 0;

      for (const event of events) {
        if (event.index > lastIndex) {
          html += escapeHtml(lineText.substring(lastIndex, event.index));
          lastIndex = event.index;
        }

        if (event.kind === 'start') {
          const token = event.data;
          let dataAttr = "";
          if (options.synchronizedHovers) {
            if (token.groupId) dataAttr += ` data-symbol="${token.groupId}"`;
            if (token.hoverText) dataAttr += ` data-hover="${escapeHtml(token.hoverText)}"`;
          }
          const cls = token.type ? `lean-${token.type}` : "lean-hover-span";
          html += `<span class="${cls}"${dataAttr}>`;
        } else if (event.kind === 'end') {
          html += `</span>`;
        } else if (event.kind === 'goal') {
          const goal = event.data;
          html += `<span class="lean-goal-marker" data-hover="${escapeHtml(goal.compiledHtml)}">⊢</span>`;
        }
      }

      if (lastIndex < lineText.length) {
        html += escapeHtml(lineText.substring(lastIndex));
      }

      return html;
    });

    this.sendNotification("textDocument/didClose", {
      textDocument: { uri: tempFileUri }
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
      console.log(`sent req ${method}: ${JSON.stringify(params)}`)
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

function addTargetBlank(html: string): string {
  return html.replace(/<a\b([^>]*)/gi, (match, p1) => {
    if (/target\s*=/i.test(p1)) {
      return match;
    }
    return `<a${p1} target="_blank" rel="noopener noreferrer"`;
  });
}

function highlightGoalHtml(
  html: string,
  wordMap: Map<string, { type: string; groupId?: string; hoverText?: string }>
): string {
  const codeBlockRegex = /<code class="language-lean">([\s\S]*?)<\/code>/g;

  return html.replace(codeBlockRegex, (match, codeText) => {
    const entityOrIdentRegex = /&[a-zA-Z0-9#]+;|([a-zA-Z_α-ωΑ-Ω][a-zA-Z0-9_α-ωΑ-Ω']*)/g;
    
    const highlightedCode = codeText.replace(entityOrIdentRegex, (m: string, word: string | undefined) => {
      if (!word) return m; // It was an HTML entity, keep it unchanged
      
      const info = wordMap.get(word);
      if (info) {
        let dataAttr = "";
        if (info.groupId) {
          dataAttr += ` data-symbol="${info.groupId}"`;
        }
        if (info.hoverText) {
          dataAttr += ` data-hover="${escapeHtml(info.hoverText)}"`;
        }
        return `<span class="lean-${info.type}"${dataAttr}>${word}</span>`;
      }
      return word;
    });

    return `<code class="language-lean">${highlightedCode}</code>`;
  });
}
