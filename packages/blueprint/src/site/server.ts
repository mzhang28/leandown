import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const RELOAD_PATH = "/__blueprint_reload";
const RELOAD_SNIPPET = `<script>new EventSource("${RELOAD_PATH}").onmessage = () => location.reload();</script>`;

export interface DevServerOptions {
  /** Directory with the built site. */
  outDir: string;
  /** doc-gen4 output, served under /docs/ (optional). */
  docsDir?: string;
}

/**
 * A static file server for the built site that injects a live-reload
 * snippet into HTML pages. Call `reload()` after each rebuild.
 */
export class DevServer {
  private readonly clients = new Set<http.ServerResponse>();
  readonly server: http.Server;

  constructor(private readonly options: DevServerOptions) {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  /** Listens on `port`, or the next free one if `strict` isn't set. */
  async listen(port: number, host?: string, strict = false): Promise<number> {
    for (let p = port; ; p++) {
      try {
        return await new Promise<number>((resolve, reject) => {
          this.server.once("error", reject);
          this.server.listen(p, host, () => {
            this.server.off("error", reject);
            const addr = this.server.address();
            resolve(typeof addr === "object" && addr ? addr.port : p);
          });
        });
      } catch (err) {
        if (strict || (err as NodeJS.ErrnoException).code !== "EADDRINUSE" || p >= port + 20) throw err;
      }
    }
  }

  reload(): void {
    for (const client of this.clients) client.write("data: reload\n\n");
  }

  close(): Promise<void> {
    for (const client of this.clients) client.end();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const rawPath = (req.url ?? "/").split("?")[0]!.split("#")[0]!;
    if (rawPath === RELOAD_PATH) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write("\n");
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
      return;
    }

    let reqPath: string;
    try {
      reqPath = decodeURIComponent(rawPath);
    } catch {
      return this.send(res, 400, "Bad Request");
    }
    if (reqPath.includes("\0")) return this.send(res, 400, "Bad Request");

    const { docsDir, outDir } = this.options;
    const inDocs = reqPath === "/docs" || reqPath.startsWith("/docs/");
    const root = path.resolve(inDocs && docsDir ? docsDir : outDir);
    const rel = inDocs && docsDir ? reqPath.slice("/docs".length) : reqPath;
    const candidates = [
      path.resolve(root, "." + rel),
      path.resolve(root, "." + rel, "index.html"),
      path.resolve(root, "." + rel + ".html"),
    ];
    for (const file of candidates) {
      // Stay inside the served directory ("/../../etc/passwd" and friends).
      if (file !== root && !file.startsWith(root + path.sep)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const type = MIME[path.extname(file)] ?? "application/octet-stream";
      if (type.startsWith("text/html") && !inDocs) {
        const html = fs.readFileSync(file, "utf-8");
        const injected = html.includes("</body>")
          ? html.replace("</body>", () => `${RELOAD_SNIPPET}</body>`)
          : html + RELOAD_SNIPPET;
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(injected);
      } else {
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        fs.createReadStream(file).pipe(res);
      }
      return;
    }

    if (inDocs) {
      return this.send(res, 404, "Lean docs not built. Run `blueprint docs`, then reload.");
    }
    this.send(res, 404, "Not found");
  }

  private send(res: http.ServerResponse, status: number, body: string): void {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(body);
  }
}
