import { createServer } from "vite";
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkLean, { renderLeanLoadingIndicator } from "@leandown/remark";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadBook,
  findChapter,
  renderNav,
  renderPager,
  type Book,
  type Chapter,
} from "./book";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function renderChapter(
  book: Book,
  chapter: Chapter,
  leanProjectPath: string
): Promise<string> {
  const markdownPath = resolve(__dirname, chapter.file);
  const markdown = await readFile(markdownPath, "utf8");
  const result = await remark()
    .use(remarkLean, {
      leanProjectPath,
      synchronizedHovers: true,
      cacheDir: process.env.REMARK_LEAN_CACHE_DIR,
    })
    .use(remarkHtml, { sanitize: false })
    .process(markdown);

  return result.toString();
}

function renderShell(
  book: Book,
  chapter: Chapter,
  template: string
): string {
  const nav = renderNav(book, chapter.slug);
  const loading = renderLeanLoadingIndicator();

  return template
    .replace("<title>Lean Markdown Renderer</title>", `<title>${chapter.title} · ${book.title}</title>`)
    .replace(`<div id="nav"></div>`, `<div id="nav">${nav}</div>`)
    .replace(
      `<div id="content"></div>`,
      `<div id="content" data-lean-chapter="${chapter.slug}" aria-busy="true">${loading}</div>`
    )
    .replace(`<div id="pager"></div>`, `<div id="pager"></div>`);
}

async function renderChapterPayload(
  book: Book,
  chapter: Chapter,
  leanProjectPath: string
): Promise<{ content: string; pager: string; title: string }> {
  const content = await renderChapter(book, chapter, leanProjectPath);
  return {
    content,
    pager: renderPager(book, chapter.slug),
    title: `${chapter.title} · ${book.title}`,
  };
}

function resolveChapter(book: Book, pathname: string): Chapter | null {
  const slug = pathname === "/" || pathname === "/index.html"
    ? book.chapters[0]?.slug
    : pathname.replace(/^\//, "");

  if (!slug) return null;
  return findChapter(book, slug) ?? null;
}

async function startServer() {
  const leanProjectPath = fileURLToPath(new URL("../lean", import.meta.url));
  const book = await loadBook(__dirname);
  const template = await readFile(resolve(__dirname, "index.html"), "utf8");

  const defaultPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 5173;

  const server = await createServer({
    server: {
      port: defaultPort,
      host: "0.0.0.0",
      allowedHosts: ["ephemeral"],
      strictPort: true,
    },
    resolve: {
      alias: {
        "@leandown/core/lean.css": resolve(__dirname, "../../../packages/core/lean.css"),
        "@leandown/core/runtime": resolve(__dirname, "../../../packages/core/src/runtime.ts"),
        "@leandown/remark": resolve(__dirname, "../../../packages/remark/src/index.ts"),
        "@leandown/core": resolve(__dirname, "../../../packages/core/src/index.ts"),
      },
    },
    optimizeDeps: {
      exclude: ["@leandown/remark", "@leandown/core"],
    },
    plugins: [
      {
        name: "markdown-render-server",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (!req.url) return next();

            const pathname = new URL(req.url, "http://localhost").pathname;

            const renderMatch = pathname.match(/^\/_lean\/render\/([^/]+)$/);
            if (renderMatch) {
              const chapter = findChapter(book, decodeURIComponent(renderMatch[1]!));
              if (!chapter) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: "Chapter not found" }));
                return;
              }

              try {
                const payload = await renderChapterPayload(book, chapter, leanProjectPath);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(payload));
              } catch (err) {
                next(err);
              }
              return;
            }

            const chapter = resolveChapter(book, pathname);
            if (!chapter) return next();

            try {
              let html = renderShell(book, chapter, template);
              html = await server.transformIndexHtml(pathname, html);

              res.setHeader("Content-Type", "text/html");
              res.end(html);
            } catch (err) {
              next(err);
            }
          });
        },
      },
    ],
  });

  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address !== null ? address.port : defaultPort;
  console.log(`Textbook server listening at http://localhost:${port}/`);
  console.log("Chapters:");
  for (const chapter of book.chapters) {
    const isFirst = chapter.slug === book.chapters[0]?.slug;
    const url = isFirst
      ? `http://localhost:${port}/`
      : `http://localhost:${port}/${chapter.slug}`;
    console.log(`  ${url}  — ${chapter.title}`);
  }
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
