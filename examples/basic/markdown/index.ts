import { createServer } from "vite";
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkLean from "remark-lean";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const rootUri = new URL("../lean", import.meta.url).toString();

  const defaultPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 5173;

  const server = await createServer({
    server: {
      port: defaultPort,
      host: "0.0.0.0",
      allowedHosts: ["ephemeral"],
      strictPort: true
    },
    resolve: {
      alias: {
        "remark-lean/runtime": resolve(__dirname, "../../../packages/remark-lean/src/runtime.ts"),
        "remark-lean": resolve(__dirname, "../../../packages/remark-lean/src/index.ts")
      }
    },
    optimizeDeps: {
      exclude: ["remark-lean"]
    },
    plugins: [
      {
        name: "markdown-render-server",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url === "/" || req.url === "/index.html") {
              try {
                // Read and compile the markdown using remark & remark-lean
                const markdownPath = resolve(__dirname, "example.md");
                const markdown = await readFile(markdownPath, "utf8");
                const htmlContent = await remark()
                  .use(remarkLean, {
                    rootUri,
                    synchronizedHovers: true,
                    cacheDir: process.env.REMARK_LEAN_CACHE_DIR
                  })
                  .use(remarkHtml, { sanitize: false })
                  .process(markdown);

                // Load the HTML template
                const templatePath = resolve(__dirname, "index.html");
                let html = await readFile(templatePath, "utf8");
                
                // Inject the generated HTML content into the placeholder in index.html
                html = html.replace(
                  `<div id="content"></div>`,
                  `<div id="content">${htmlContent}</div>`
                );

                // Apply Vite's HTML transforms (e.g. dev server client script injection, stylesheet href resolution)
                html = await server.transformIndexHtml(req.url || "/", html);

                res.setHeader("Content-Type", "text/html");
                res.end(html);
              } catch (err) {
                next(err);
              }
            } else {
              next();
            }
          });
        }
      }
    ]
  });

  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address !== null ? address.port : defaultPort;
  console.log(`Server listening at http://localhost:${port}/`);
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
