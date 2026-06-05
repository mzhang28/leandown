import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface Token {
  line: number;
  start: number;
  length: number;
  type: string;
  groupId?: string;
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
      const lines = content.split("\n");

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineText = lines[lineIndex] || "";
        let match;
        regex.lastIndex = 0;
        
        while ((match = regex.exec(lineText)) !== null) {
          const word = match[0];
          const startChar = match.index;
          const length = word.length;

          // Check if there is an existing token at this position
          const existingToken = tokens.find(t => t.line === lineIndex && t.start === startChar);
          if (existingToken && skipTypes.has(existingToken.type)) {
            continue;
          }

          const defRes = await this.sendRequest("textDocument/definition", {
            textDocument: { uri: this.tempFileUri },
            position: { line: lineIndex + prependLines, character: startChar }
          });

          const defs: any[] = Array.isArray(defRes.result) 
            ? defRes.result 
            : (defRes.result ? [defRes.result] : []);

          if (defs.length > 0) {
            const def = defs[0];
            const uri = def.targetUri || def.uri;
            const range = def.targetSelectionRange || def.targetRange || def.range;
            
            if (uri && range && tempFileName && uri.endsWith(tempFileName)) {
              const defLine = range.start.line;
              const defChar = range.start.character;
              const groupId = `ref-${defLine}-${defChar}`;

              if (existingToken) {
                existingToken.groupId = groupId;
              } else {
                tokens.push({
                  line: lineIndex,
                  start: startChar,
                  length,
                  type: "variable",
                  groupId
                });
              }
            }
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
        if (options.synchronizedHovers && token.groupId) {
          dataAttr = ` data-symbol="${token.groupId}"`;
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
