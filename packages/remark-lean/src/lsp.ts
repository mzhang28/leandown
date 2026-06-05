import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface Token {
  line: number;
  start: number;
  length: number;
  type: string;
}

export class LeanLSPClient {
  private proc: ChildProcess | null = null;
  private buffer = Buffer.alloc(0);
  private nextRequestId = 1;
  private pendingRequests = new Map<number, (res: any) => void>();
  private compileWaiters = new Map<string, () => void>();
  private legend: string[] = [];
  private cwd: string;
  private nextFileId = 1;

  constructor(private rootUri: string) {
    this.cwd = rootUri.startsWith("file://")
      ? fileURLToPath(rootUri)
      : rootUri;
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

  async highlight(content: string): Promise<string> {
    if (!this.proc) {
      await this.start();
    }

    const tempFileUri = `${this.rootUri}/__temp_remark_lean_${this.nextFileId++}__.lean`;

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: tempFileUri,
        languageId: "lean",
        version: 1,
        text: content
      }
    });

    await Promise.race([
      new Promise<void>((resolve) => this.compileWaiters.set(tempFileUri, resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, 1500))
    ]);

    const tokensRes = await this.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: tempFileUri }
    });

    this.sendNotification("textDocument/didClose", {
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
      tokens.push({
        line: currentLine,
        start: currentCol,
        length,
        type
      });
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
        html += `<span class="lean-${token.type}">${escapeHtml(tokenText)}</span>`;
        lastIndex = token.start + token.length;
      }
      html += escapeHtml(lineText.substring(lastIndex));
      return html;
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
