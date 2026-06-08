import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { parseMarkdownLean, isLineInLeanBlock, type LeanBlock } from "./markdown-parser.ts";

interface DocState {
  markdownUri: vscode.Uri;
  leanUri: vscode.Uri;
  blocks: LeanBlock[];
  hasOpenedCompanion: boolean;
  hasStartedClient?: boolean;
}

const activeDocs = new Map<string, DocState>();
const createdFiles = new Set<string>();
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log("[LeanMarkdown] activate() called - starting activation");

  try {
    diagnosticCollection = vscode.languages.createDiagnosticCollection("leandown");
    context.subscriptions.push(diagnosticCollection);
    console.log("[LeanMarkdown] Diagnostic collection initialized");
  } catch (err) {
    console.error("[LeanMarkdown] Failed to create diagnostic collection:", err);
  }

  // Hook into document lifecycle
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      console.log(`[LeanMarkdown] onDidOpenTextDocument: uri=${doc.uri.toString()}, languageId=${doc.languageId}, scheme=${doc.uri.scheme}`);
      if (doc.languageId === "markdown" && doc.uri.scheme === "file") {
        syncMarkdownToLean(doc);
      }
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      console.log(`[LeanMarkdown] onDidChangeTextDocument: uri=${event.document.uri.toString()}, languageId=${event.document.languageId}`);
      if (event.document.languageId === "markdown" && event.document.uri.scheme === "file") {
        syncMarkdownToLean(event.document);
      }
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      console.log(`[LeanMarkdown] onDidCloseTextDocument: uri=${doc.uri.toString()}, languageId=${doc.languageId}`);
      if (doc.languageId === "markdown" && doc.uri.scheme === "file") {
        cleanupCompanionFile(doc.uri);
      }
    })
  );

  // Sync any markdown files already open when the extension starts
  console.log(`[LeanMarkdown] Deferring initial sync for open documents to allow VS Code workspace folders initialization...`);
  setTimeout(() => {
    console.log(`[LeanMarkdown] Starting initial sync. Total open in editor memory: ${vscode.workspace.textDocuments.length}`);
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "markdown" && doc.uri.scheme === "file") {
        console.log(`[LeanMarkdown] Initial sync for already open document: ${doc.uri.toString()}`);
        syncMarkdownToLean(doc);
      }
    }
  }, 1000);

  // Diagnostics sync
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((event) => {
      for (const uri of event.uris) {
        const state = findStateByLeanUri(uri);
        if (state) {
          console.log(`[LeanMarkdown] Diagnostics changed for companion Lean file: ${uri.toString()}`);
          const leanDiagnostics = vscode.languages.getDiagnostics(uri);
          const mappedDiagnostics: vscode.Diagnostic[] = [];

          for (const diag of leanDiagnostics) {
            if (isLineInLeanBlock(diag.range.start.line, state.blocks)) {
              mappedDiagnostics.push(diag);
            }
          }

          console.log(`[LeanMarkdown] Forwarding ${mappedDiagnostics.length}/${leanDiagnostics.length} diagnostics to Markdown file: ${state.markdownUri.toString()}`);
          diagnosticCollection.set(state.markdownUri, mappedDiagnostics);
        }
      }
    })
  );

  // Selection sync
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const editor = event.textEditor;
      if (editor.document.languageId !== "markdown") return;

      const state = activeDocs.get(editor.document.uri.toString());
      if (!state) return;

      const primarySelection = event.selections[0];
      const cursorLine = primarySelection.active.line;

      if (isLineInLeanBlock(cursorLine, state.blocks)) {
        const leanEditor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === state.leanUri.toString()
        );

        if (leanEditor) {
          const newPosition = primarySelection.active;
          const newSelection = new vscode.Selection(newPosition, newPosition);
          console.log(`[LeanMarkdown] Syncing cursor selection to companion editor: line=${newPosition.line}, char=${newPosition.character}`);
          leanEditor.selection = newSelection;
          leanEditor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
      }
    })
  );

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("leandown.openLeanFile", async () => {
      console.log("[LeanMarkdown] Command leandown.openLeanFile invoked");
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor || activeEditor.document.languageId !== "markdown") {
        vscode.window.showWarningMessage("Please focus a Markdown file to open its companion Lean file.");
        return;
      }
      const state = activeDocs.get(activeEditor.document.uri.toString());
      if (state) {
        console.log(`[LeanMarkdown] Opening companion editor for state: ${state.leanUri.toString()}`);
        await openCompanionLeanEditor(state);
      } else {
        console.warn(`[LeanMarkdown] No tracked state found for active Markdown editor: ${activeEditor.document.uri.toString()}`);
      }
    }),

    vscode.commands.registerCommand("leandown.syncLeanFile", () => {
      console.log("[LeanMarkdown] Command leandown.syncLeanFile invoked");
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor || activeEditor.document.languageId !== "markdown") return;
      syncMarkdownToLean(activeEditor.document, true);
      vscode.window.showInformationMessage("Companion Lean file synchronized.");
    })
  );

  // Register Hover Provider for Markdown
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("markdown", {
      async provideHover(document, position, token) {
        console.log(`[LeanMarkdown] Hover requested: line=${position.line}, char=${position.character}`);
        const state = activeDocs.get(document.uri.toString());
        if (!state) {
          console.log(`[LeanMarkdown] Hover: No active document state for ${document.uri.toString()}`);
          return undefined;
        }
        if (!isLineInLeanBlock(position.line, state.blocks)) {
          console.log(`[LeanMarkdown] Hover: Position not inside any Lean block. Blocks: ${JSON.stringify(state.blocks)}`);
          return undefined;
        }

        console.log(`[LeanMarkdown] Hover: Forwarding hover request to Lean companion at ${state.leanUri.toString()}`);
        try {
          const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider",
            state.leanUri,
            position
          );
          if (hovers && hovers.length > 0) {
            console.log(`[LeanMarkdown] Hover: Succeeded. Found ${hovers.length} hover entries.`);
            const contents: vscode.MarkdownString[] = [];
            for (const h of hovers) {
              contents.push(...h.contents.map(c => {
                if (typeof c === "string") {
                  return new vscode.MarkdownString(c);
                }
                return c;
              }));
            }
            return new vscode.Hover(contents);
          } else {
            console.log(`[LeanMarkdown] Hover: Empty results returned from executeHoverProvider.`);
          }
        } catch (err) {
          console.error("[LeanMarkdown] Hover: Error executing hover provider for Lean companion:", err);
        }
        return undefined;
      }
    })
  );

  // Register Definition Provider for Markdown
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider("markdown", {
      async provideDefinition(document, position, token) {
        console.log(`[LeanMarkdown] Definition requested: line=${position.line}, char=${position.character}`);
        const state = activeDocs.get(document.uri.toString());
        if (!state || !isLineInLeanBlock(position.line, state.blocks)) {
          console.log(`[LeanMarkdown] Definition: Not tracked or not in Lean block.`);
          return undefined;
        }

        console.log(`[LeanMarkdown] Definition: Forwarding request to ${state.leanUri.toString()}`);
        try {
          const results = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
            "vscode.executeDefinitionProvider",
            state.leanUri,
            position
          );

          if (!results) {
            console.log(`[LeanMarkdown] Definition: Empty results returned.`);
            return undefined;
          }

          console.log(`[LeanMarkdown] Definition: Found ${results.length} targets. Mapping URIs...`);
          const mappedResults: (vscode.Location | vscode.LocationLink)[] = [];

          for (const res of results) {
            if ("targetUri" in res) {
              const targetUri = res.targetUri;
              if (targetUri.toString() === state.leanUri.toString()) {
                res.targetUri = state.markdownUri;
              }
              mappedResults.push(res);
            } else {
              const targetUri = res.uri;
              if (targetUri.toString() === state.leanUri.toString()) {
                mappedResults.push(new vscode.Location(state.markdownUri, res.range));
              } else {
                mappedResults.push(res);
              }
            }
          }

          return mappedResults as any;
        } catch (err) {
          console.error("[LeanMarkdown] Definition: Error executing definition provider:", err);
        }
        return undefined;
      }
    })
  );

  // Register Semantic Tokens Provider for Markdown
  const legend = new vscode.SemanticTokensLegend(
    [
      "keyword", "variable", "property", "function", "namespace", "type", 
      "class", "enum", "interface", "struct", "typeParameter", "parameter", 
      "enumMember", "event", "method", "macro", "modifier", "comment", 
      "string", "number", "regexp", "operator", "decorator", "leanSorryLike"
    ],
    [
      "declaration", "definition", "readonly", "static", "deprecated",
      "abstract", "async", "modification", "documentation", "defaultLibrary"
    ]
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      "markdown",
      {
        async provideDocumentSemanticTokens(document, token) {
          const state = activeDocs.get(document.uri.toString());
          if (!state) return undefined;

          console.log(`[LeanMarkdown] Semantic tokens requested for: ${document.uri.toString()}`);
          try {
            const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
              "vscode.provideDocumentSemanticTokens",
              state.leanUri
            );
            if (tokens) {
              console.log(`[LeanMarkdown] Semantic tokens: Forwarded successfully. Data size: ${tokens.data.length}`);
              return tokens;
            } else {
              console.log(`[LeanMarkdown] Semantic tokens: Empty results returned from provideDocumentSemanticTokens`);
            }
          } catch (err) {
            console.warn("[LeanMarkdown] Semantic tokens: provideDocumentSemanticTokens failed (likely not registered yet):", err);
          }
          return undefined;
        }
      },
      legend
    )
  );

  console.log("[LeanMarkdown] activation completed successfully");
}

export function deactivate() {
  console.log("[LeanMarkdown] deactivate() called, cleaning up files");
  for (const docState of activeDocs.values()) {
    cleanupCompanionFile(docState.markdownUri);
  }
  for (const filePath of createdFiles) {
    try {
      if (fs.existsSync(filePath)) {
        console.log(`[LeanMarkdown] Deleting session companion file: ${filePath}`);
        fs.unlinkSync(filePath);
      }
    } catch (_) {}
  }
}

function findLeanProjectRoot(startDir: string): string | undefined {
  let dir = startDir;
  console.log(`[LeanMarkdown] Searching upwards for Lean project starting from: ${startDir}`);
  while (true) {
    if (
      fs.existsSync(path.join(dir, "lakefile.toml")) ||
      fs.existsSync(path.join(dir, "lakefile.lean")) ||
      fs.existsSync(path.join(dir, "lean-toolchain"))
    ) {
      console.log(`[LeanMarkdown] Found Lean project root upwards at: ${dir}`);
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  console.log("[LeanMarkdown] No Lean project root found upwards");
  return undefined;
}

function findRepositoryRoot(startDir: string): string | undefined {
  let dir = startDir;
  console.log(`[LeanMarkdown] Searching upwards for repository/workspace root starting from: ${startDir}`);
  let packageJsonDir: string | undefined = undefined;

  while (true) {
    if (fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, "Justfile"))) {
      console.log(`[LeanMarkdown] Found repository/workspace root (git/Justfile) at: ${dir}`);
      return dir;
    }
    if (fs.existsSync(path.join(dir, "package.json"))) {
      packageJsonDir = dir; // Tracks the highest package.json directory we find
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  if (packageJsonDir) {
    console.log(`[LeanMarkdown] Found repository/workspace root (highest package.json) at: ${packageJsonDir}`);
    return packageJsonDir;
  }

  console.log("[LeanMarkdown] No repository/workspace root found upwards");
  return undefined;
}

function findClosestLeanProject(markdownUri: vscode.Uri): string | undefined {
  const mdPath = markdownUri.fsPath;
  const mdDir = path.dirname(mdPath);

  // 1. Search upwards for a Lean project
  const rootUpward = findLeanProjectRoot(mdDir);
  if (rootUpward) return rootUpward;

  // 2. Scan directories: use workspace folders and/or the repository root
  const scanDirs = new Set<string>();

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      scanDirs.add(folder.uri.fsPath);
    }
  }

  const repoRoot = findRepositoryRoot(mdDir);
  if (repoRoot) {
    scanDirs.add(repoRoot);
  }

  if (scanDirs.size === 0) {
    console.log("[LeanMarkdown] No directories to scan. Fallback to undefined closest project");
    return undefined;
  }

  console.log(`[LeanMarkdown] Scanning directories for Lean projects: ${JSON.stringify(Array.from(scanDirs))}`);
  let closestProjectDir: string | undefined = undefined;
  let minDistance = Infinity;

  const findLeanProjectsInDir = (dir: string, depth = 0): string[] => {
    if (depth > 5) return [];
    const results: string[] = [];
    try {
      if (
        fs.existsSync(path.join(dir, "lakefile.toml")) ||
        fs.existsSync(path.join(dir, "lakefile.lean")) ||
        fs.existsSync(path.join(dir, "lean-toolchain"))
      ) {
        results.push(dir);
      }
      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const f of files) {
        if (f.isDirectory() && f.name !== "node_modules" && !f.name.startsWith(".")) {
          results.push(...findLeanProjectsInDir(path.join(dir, f.name), depth + 1));
        }
      }
    } catch (_) {}
    return results;
  };

  for (const dir of scanDirs) {
    const projects = findLeanProjectsInDir(dir);
    console.log(`[LeanMarkdown] Scan dir '${dir}' projects found: ${JSON.stringify(projects)}`);
    for (const proj of projects) {
      const relative = path.relative(mdDir, proj);
      const steps = relative.split(path.sep).filter(p => p !== ".").length;
      console.log(`[LeanMarkdown] Project: ${proj}, Relative steps from mdDir: ${steps}`);
      if (steps < minDistance) {
        minDistance = steps;
        closestProjectDir = proj;
      }
    }
  }

  console.log(`[LeanMarkdown] Closest Lean project resolved: ${closestProjectDir}`);
  return closestProjectDir;
}

let tempProjectPath: string | null = null;

function getOrCreateTempProject(): string {
  if (tempProjectPath !== null) return tempProjectPath;

  const dir = path.join(os.tmpdir(), "leandown-temp-project");
  console.log(`[LeanMarkdown] Initializing empty temp Lean project workspace at: ${dir}`);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let toolchain = "leanprover/lean4:stable";
    try {
      console.log("[LeanMarkdown] Executing 'lean --version' with timeout");
      const output = execSync("lean --version", { encoding: "utf8", timeout: 1000 });
      const match = output.match(/version\s+([v0-9.]+)/i);
      if (match && match[1]) {
        const ver = match[1].startsWith("v") ? match[1] : `v${match[1]}`;
        toolchain = `leanprover/lean4:${ver}`;
      }
      console.log(`[LeanMarkdown] Matched toolchain version: ${toolchain}`);
    } catch (err) {
      console.warn("[LeanMarkdown] Failed to run 'lean --version', defaulting to stable toolchain", err);
    }

    const lakefilePath = path.join(dir, "lakefile.toml");
    if (!fs.existsSync(lakefilePath)) {
      fs.writeFileSync(
        lakefilePath,
        `name = "lean_highlight_scratch"\nversion = "0.1.0"\n`
      );
    }

    const toolchainPath = path.join(dir, "lean-toolchain");
    if (!fs.existsSync(toolchainPath)) {
      fs.writeFileSync(toolchainPath, toolchain);
    }

    tempProjectPath = dir;
    console.log("[LeanMarkdown] Temp Lean project initialized successfully");
  } catch (err) {
    console.error("[LeanMarkdown] Failed to create temp Lean project:", err);
    tempProjectPath = dir;
  }
  return tempProjectPath;
}

function getCompanionUris(markdownUri: vscode.Uri): { leanUri: vscode.Uri; leanPath: string } {
  const config = vscode.workspace.getConfiguration("leandown");
  const configTempDir = config.get<string>("tempDir", "").trim();

  const leanProjectRoot = findClosestLeanProject(markdownUri);
  let tempBaseDir: string;

  if (configTempDir) {
    console.log(`[LeanMarkdown] Using configurable tempDir: ${configTempDir}`);
    if (path.isAbsolute(configTempDir)) {
      tempBaseDir = configTempDir;
    } else if (leanProjectRoot) {
      tempBaseDir = path.resolve(leanProjectRoot, configTempDir);
    } else {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(markdownUri);
      if (workspaceFolder) {
        tempBaseDir = path.resolve(workspaceFolder.uri.fsPath, configTempDir);
      } else {
        tempBaseDir = path.resolve(getOrCreateTempProject(), configTempDir);
      }
    }
  } else if (leanProjectRoot) {
    console.log(`[LeanMarkdown] Resolving companion inside closest Lean project: ${leanProjectRoot}`);
    tempBaseDir = path.join(leanProjectRoot, ".leandown");
  } else {
    console.log("[LeanMarkdown] No project root. Fallback to temp project workspace");
    tempBaseDir = getOrCreateTempProject();
  }

  let leanPath: string;
  const repoRoot = findRepositoryRoot(path.dirname(markdownUri.fsPath));
  const baseDirForRelPath = repoRoot || (vscode.workspace.getWorkspaceFolder(markdownUri)?.uri.fsPath);

  if (baseDirForRelPath) {
    const relPath = path.relative(baseDirForRelPath, markdownUri.fsPath);
    if (relPath.startsWith("..") || path.isAbsolute(relPath)) {
      const safeName = markdownUri.fsPath.replace(/[^a-zA-Z0-9]/g, "_");
      leanPath = path.join(tempBaseDir, `${safeName}.lean`);
      console.log(`[LeanMarkdown] Path resolved via flat safeName (escaped relPath): ${leanPath}`);
    } else {
      leanPath = path.join(tempBaseDir, relPath + ".lean");
      console.log(`[LeanMarkdown] Path resolved via relative path inside baseDir: ${leanPath}`);
    }
  } else {
    const safeName = markdownUri.fsPath.replace(/[^a-zA-Z0-9]/g, "_");
    leanPath = path.join(tempBaseDir, `${safeName}.lean`);
    console.log(`[LeanMarkdown] Path resolved via flat safeName: ${leanPath}`);
  }

  return {
    leanUri: vscode.Uri.file(leanPath),
    leanPath,
  };
}

function findStateByLeanUri(leanUri: vscode.Uri): DocState | undefined {
  const uriStr = leanUri.toString();
  for (const state of activeDocs.values()) {
    if (state.leanUri.toString() === uriStr) {
      return state;
    }
  }
  return undefined;
}

async function syncMarkdownToLean(doc: vscode.TextDocument, forceOpenCompanion = false) {
  const markdownUriStr = doc.uri.toString();
  console.log(`[LeanMarkdown] syncMarkdownToLean started for: ${markdownUriStr}`);

  const { leanUri, leanPath } = getCompanionUris(doc.uri);
  const { leanContent, blocks } = parseMarkdownLean(doc.getText());

  console.log(`[LeanMarkdown] Parsed Lean blocks count: ${blocks.length}`);
  if (blocks.length === 0) {
    if (activeDocs.has(markdownUriStr)) {
      console.log("[LeanMarkdown] Lean blocks count is 0. Cleaning up previous state");
      cleanupCompanionFile(doc.uri);
    } else {
      console.log("[LeanMarkdown] Lean blocks count is 0. Ignoring document");
    }
    return;
  }

  let state = activeDocs.get(markdownUriStr);
  if (!state) {
    state = {
      markdownUri: doc.uri,
      leanUri,
      blocks,
      hasOpenedCompanion: false,
    };
    activeDocs.set(markdownUriStr, state);
    console.log(`[LeanMarkdown] Added new active doc state. Tracked count: ${activeDocs.size}`);
  } else {
    state.blocks = blocks;
    console.log("[LeanMarkdown] Updated active doc state blocks");
  }

  // Ensure file exists on disk
  try {
    const parentDir = path.dirname(leanPath);
    if (!fs.existsSync(parentDir)) {
      console.log(`[LeanMarkdown] Creating parent directories for companion file: ${parentDir}`);
      fs.mkdirSync(parentDir, { recursive: true });
    }
    if (!fs.existsSync(leanPath)) {
      console.log(`[LeanMarkdown] Creating initial companion file on disk: ${leanPath}`);
      fs.writeFileSync(leanPath, leanContent, "utf8");
      createdFiles.add(leanPath);
    }
  } catch (err) {
    console.error(`[LeanMarkdown] Failed to initialize companion file on disk at ${leanPath}:`, err);
    return;
  }

  // Open the document in memory and apply edits
  try {
    console.log(`[LeanMarkdown] vscode.workspace.openTextDocument starting for ${leanUri.toString()}`);
    const leanDoc = await vscode.workspace.openTextDocument(leanUri);
    console.log(`[LeanMarkdown] openTextDocument succeeded. Memory doc size: ${leanDoc.getText().length} chars`);

    if (leanDoc.getText() !== leanContent) {
      console.log("[LeanMarkdown] Document text mismatch. Syncing in-memory content via WorkspaceEdit");
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        leanDoc.positionAt(0),
        leanDoc.positionAt(leanDoc.getText().length)
      );
      edit.replace(leanUri, fullRange, leanContent);
      const applied = await vscode.workspace.applyEdit(edit);
      console.log(`[LeanMarkdown] WorkspaceEdit applied result: ${applied}`);
      
      const saved = await leanDoc.save();
      console.log(`[LeanMarkdown] Document save result: ${saved}`);
    } else {
      console.log("[LeanMarkdown] In-memory document text already matches Markdown Lean blocks. Skipping edit.");
    }
  } catch (err) {
    console.error(`[LeanMarkdown] Failed to open/sync companion document in memory:`, err);
    return;
  }

  // Ensure Lean client is started (will trigger LSP client activation)
  if (!state.hasStartedClient) {
    await ensureLeanClientStarted(state);
  }

  if (forceOpenCompanion) {
    state.hasOpenedCompanion = true;
    console.log(`[LeanMarkdown] Opening companion editor side-by-side (forced)`);
    await openCompanionLeanEditor(state);
  }
}

async function closeLeanTab(leanUri: vscode.Uri) {
  console.log(`[LeanMarkdown] Attempting to close tab for companion: ${leanUri.toString()}`);
  let found = false;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input && tab.input instanceof vscode.TabInputText) {
        if (tab.input.uri.toString() === leanUri.toString()) {
          console.log(`[LeanMarkdown] Found tab to close: ${tab.input.uri.toString()}`);
          try {
            const closed = await vscode.window.tabGroups.close(tab);
            console.log(`[LeanMarkdown] Tab close result: ${closed}`);
            found = true;
          } catch (err) {
            console.error(`[LeanMarkdown] Error closing tab:`, err);
          }
        }
      }
    }
  }
  if (!found) {
    console.log(`[LeanMarkdown] No matching tab found to close for: ${leanUri.toString()}`);
  }
}

async function ensureLeanClientStarted(state: DocState) {
  if (state.hasStartedClient) return;
  state.hasStartedClient = true;

  const config = vscode.workspace.getConfiguration("leandown");
  const autoOpen = config.get<boolean>("autoOpenCompanion", false);

  console.log(`[LeanMarkdown] ensureLeanClientStarted called for: ${state.leanUri.toString()}. autoOpenCompanion: ${autoOpen}`);

  const leanExt = vscode.extensions.getExtension("leanprover.lean4");
  if (!leanExt) {
    console.warn("[LeanMarkdown] Lean 4 extension (leanprover.lean4) not found or not installed");
    return;
  }
  console.log(`[LeanMarkdown] Lean 4 extension found. Active status: ${leanExt.isActive}`);

  try {
    console.log(`[LeanMarkdown] Opening companion in editor briefly to trigger LSP: ${state.leanUri.toString()}`);
    const leanDoc = await vscode.workspace.openTextDocument(state.leanUri);
    const editor = await vscode.window.showTextDocument(leanDoc, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: true,
    });
    console.log(`[LeanMarkdown] Companion editor shown successfully`);

    if (!autoOpen) {
      console.log(`[LeanMarkdown] Scheduling tab close for companion in 1000ms to allow Lean extension to register it`);
      setTimeout(async () => {
        await closeLeanTab(state.leanUri);
      }, 1000);
    } else {
      state.hasOpenedCompanion = true;
    }
  } catch (err) {
    console.error("[LeanMarkdown] Error during ensureLeanClientStarted:", err);
  }
}

async function openCompanionLeanEditor(state: DocState) {
  try {
    const leanDoc = await vscode.workspace.openTextDocument(state.leanUri);
    console.log(`[LeanMarkdown] Showing companion Lean editor side-by-side in Column 2`);
    await vscode.window.showTextDocument(leanDoc, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: true,
    });
    state.hasOpenedCompanion = true;
  } catch (err) {
    console.error("[LeanMarkdown] Failed to open companion editor:", err);
  }
}

function cleanupCompanionFile(markdownUri: vscode.Uri) {
  const markdownUriStr = markdownUri.toString();
  const state = activeDocs.get(markdownUriStr);
  if (state) {
    const filePath = state.leanUri.fsPath;
    console.log(`[LeanMarkdown] Cleaning up state and companion file for Markdown document: ${markdownUriStr}`);
    try {
      if (fs.existsSync(filePath)) {
        console.log(`[LeanMarkdown] Deleting companion file: ${filePath}`);
        fs.unlinkSync(filePath);
      }
      createdFiles.delete(filePath);
    } catch (err) {
      console.error(`[LeanMarkdown] Failed to delete companion file at ${filePath}:`, err);
    }
    diagnosticCollection.delete(markdownUri);
    activeDocs.delete(markdownUriStr);
  }
}
