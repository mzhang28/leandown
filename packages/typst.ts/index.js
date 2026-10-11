"use strict";
// Node wrapper around typst.ts's WebAssembly compiler (built with leandown's
// bundle patch): reads files from disk and resolves Typst packages from the
// local package directories, downloading @preview packages on demand.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const wasm = require("./wasm/typst_ts_web_compiler.js");

/** Typst's data and cache directories, as the `typst` CLI uses them. */
function typstDirs() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    return { data: support, cache: path.join(home, "Library", "Caches") };
  }
  if (process.platform === "win32") {
    return {
      data: process.env.APPDATA || path.join(home, "AppData", "Roaming"),
      cache: process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
    };
  }
  return {
    data: process.env.XDG_DATA_HOME || path.join(home, ".local", "share"),
    cache: process.env.XDG_CACHE_HOME || path.join(home, ".cache"),
  };
}

/** Synchronously downloads `url`; the registry callback can't be async. */
function downloadSync(url) {
  const script =
    "fetch(process.argv[1]).then(async (r) => {" +
    "  if (!r.ok) { process.stderr.write(`HTTP ${r.status}`); process.exit(1); }" +
    "  process.stdout.write(Buffer.from(await r.arrayBuffer()));" +
    "}, (e) => { process.stderr.write(String(e)); process.exit(1); });";
  const res = spawnSync(process.execPath, ["-e", script, url], { maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`failed to download ${url}: ${res.stderr.toString() || res.error}`);
  }
  return res.stdout;
}

/** `this` is the compiler's ProxyContext, which provides `untar`. */
function resolvePackage(spec) {
  const dirs = typstDirs();
  const rel = path.join("typst", "packages", spec.namespace, spec.name, spec.version);
  for (const base of [dirs.data, dirs.cache]) {
    const dir = path.join(base, rel);
    if (fs.existsSync(dir)) return dir;
  }
  if (spec.namespace !== "preview") return undefined;

  const dir = path.join(dirs.cache, rel);
  const data = downloadSync(
    `https://packages.typst.org/preview/${spec.name}-${spec.version}.tar.gz`,
  );
  const tmp = `${dir}.tmp-${process.pid}`;
  this.untar(data, (file, content) => {
    const dest = path.join(tmp, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.renameSync(tmp, dir);
  return dir;
}

const accessModel = {
  mtime(p) {
    return fs.statSync(p).mtimeMs;
  },
  isFile(p) {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
  realPath(p) {
    return p;
  },
  readAll(p) {
    return new Uint8Array(fs.readFileSync(p));
  },
};

/**
 * Creates a compiler for Typst's bundle target. `fontPaths` adds font files
 * or directories (HTML output mostly doesn't need fonts).
 */
async function createCompiler(options = {}) {
  const builder = new wasm.TypstCompilerBuilder();
  await builder.set_access_model(
    accessModel,
    accessModel.mtime,
    accessModel.isFile,
    accessModel.realPath,
    accessModel.readAll,
  );
  await builder.set_package_registry(null, resolvePackage);
  for (const font of fontFiles(options.fontPaths || [])) {
    await builder.add_raw_font(new Uint8Array(fs.readFileSync(font)));
  }
  const compiler = await builder.build();

  return {
    /** Compiles `entry` with `root` as the project root. */
    bundle({ root, entry, inputs }) {
      const pairs = inputs ? Object.entries(inputs).map(([k, v]) => [k, v]) : undefined;
      const res = compiler.bundle(path.resolve(root), path.resolve(entry), pairs, 3);
      return {
        hasError: res.hasError,
        diagnostics: res.diagnostics,
        files: (res.files || []).map((f) => ({ path: f.path, content: Buffer.from(f.content) })),
      };
    },
    /** Forgets cached file contents; call before recompiling after edits. */
    reset() {
      compiler.reset();
    },
  };
}

function fontFiles(paths) {
  const out = [];
  for (const p of paths) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(p)) {
        if (/\.(ttf|otf|ttc|otc)$/i.test(name)) out.push(path.join(p, name));
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

module.exports = { createCompiler };
