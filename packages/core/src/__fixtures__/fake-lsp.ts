/**
 * Minimal stand-in for `lake serve`, speaking Content-Length framed JSON-RPC.
 * Answers `initialize` and `semanticTokens/full` (marking `def`, `theorem`
 * and `by` as keywords), replies `null` to every other request, and reports
 * each opened document as fully compiled.
 *
 * Flags (failures are counted in --state so they span restarts):
 *   --state=<file>       counter file shared across launches
 *   --crash-starts=<n>   exit(1) on startup for the first n launches
 *   --crash-opens=<n>    exit(1) on the first n `didOpen`s containing CRASH
 */
import fs from "node:fs";

const flags = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? ""];
  })
);
const stateFile = flags.state;

function bump(key: string): number {
  if (!stateFile) return 1;
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
  state[key] = (state[key] ?? 0) + 1;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  return state[key];
}

if (bump("starts") <= Number(flags["crash-starts"] ?? 0)) {
  process.stderr.write("fake-lsp: crashing on startup\n");
  process.exit(1);
}

const documents = new Map<string, string>();

/** LSP relative encoding: [deltaLine, deltaStart, length, type, modifiers]. */
function keywordTokens(text: string): number[] {
  const data: number[] = [];
  let prevLine = 0;
  let prevStart = 0;
  text.split("\n").forEach((line, lineNo) => {
    for (const m of line.matchAll(/\b(def|theorem|by)\b/g)) {
      const start = m.index!;
      data.push(lineNo - prevLine, lineNo === prevLine ? start - prevStart : start, m[0].length, 0, 0);
      prevLine = lineNo;
      prevStart = start;
    }
  });
  return data;
}

function send(msg: object): void {
  const payload = JSON.stringify({ jsonrpc: "2.0", ...msg });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
}

function handle(msg: any): void {
  if (msg.method === "textDocument/didOpen") {
    const { uri, text } = msg.params.textDocument;
    if (text.includes("CRASH") && bump("crashOpens") <= Number(flags["crash-opens"] ?? 0)) {
      process.stderr.write("fake-lsp: crashing on didOpen\n");
      process.exit(1);
    }
    documents.set(uri, text);
    send({ method: "$/lean/fileProgress", params: { textDocument: { uri }, processing: [] } });
    return;
  }
  if (msg.method === "exit") process.exit(0);
  if (msg.id === undefined) return;

  let result: unknown = null;
  if (msg.method === "initialize") {
    result = { capabilities: { semanticTokensProvider: { legend: { tokenTypes: ["keyword"] } } } };
  } else if (msg.method === "textDocument/semanticTokens/full") {
    result = { data: keywordTokens(documents.get(msg.params.textDocument.uri) ?? "") };
  }
  send({ id: msg.id, result });
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString())?.[1]);
    if (buffer.length < headerEnd + 4 + length) return;
    const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString();
    buffer = buffer.subarray(headerEnd + 4 + length);
    handle(JSON.parse(body));
  }
});
