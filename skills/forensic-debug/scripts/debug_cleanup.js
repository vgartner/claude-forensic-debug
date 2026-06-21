#!/usr/bin/env node
/*
 * debug_cleanup.js — deterministically remove debug instrumentation from a tree.
 *
 * LLMs are unreliable at hand-deleting debug logs: they leave dangling brackets,
 * break indentation, and corrupt syntax. This script removes instrumentation by
 * matching the markers the skill tells you to add, so cleanup is mechanical:
 *
 *   1. Region blocks: any line containing `#region debug` (optionally with an id,
 *      e.g. `#region debug-a1b2c3`) up to and including the matching `#endregion`.
 *      Works regardless of comment syntax (//, #, --, /* *​/, etc.) because it keys
 *      off the `#region debug` / `#endregion` tokens.
 *   2. Standalone tagged lines: any single line containing the `[DBG]` tag.
 *
 * This is why the skill requires every debug statement to be self-contained on its
 * own line — whole-line removal can then never break surrounding code.
 *
 * Usage:
 *   node scripts/debug_cleanup.js [dir]          # clean (default dir: cwd)
 *   node scripts/debug_cleanup.js [dir] --dry     # preview only, write nothing
 *   node scripts/debug_cleanup.js [dir] --tag XYZ # use a custom tag instead of [DBG]
 *
 * No dependencies. Node 18+.
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const tagIdx = args.indexOf("--tag");
const TAG = tagIdx !== -1 ? args[tagIdx + 1] : "[DBG]";
const root = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--tag") || ".");

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".debug", "dist", "build", "out", "vendor",
  "target", ".next", ".nuxt", "coverage", ".venv", "venv", "__pycache__",
]);
// Only touch source-like text files; never binaries.
const TEXT_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".scala", ".swift",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php", ".lua", ".dart",
  ".sh", ".bash", ".zsh", ".sql", ".r", ".jl", ".ex", ".exs",
  ".pas", ".dpr", ".dpk", ".inc",
]);

const reRegionStart = /#?\s*region\s+debug/i;
const reRegionEnd = /#?\s*endregion/i;
const reTag = new RegExp(TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), files);
    } else if (e.isFile() && TEXT_EXT.has(path.extname(e.name))) {
      files.push(path.join(dir, e.name));
    }
  }
  return files;
}

function cleanContent(text) {
  const lines = text.split("\n");
  const out = [];
  let removed = 0;
  let inRegion = false;

  for (const line of lines) {
    if (inRegion) {
      removed++;
      if (reRegionEnd.test(line)) inRegion = false; // remove the #endregion line too
      continue;
    }
    if (reRegionStart.test(line)) {
      removed++;
      // Guard against a single-line region (start and end on same line).
      if (!reRegionEnd.test(line)) inRegion = true;
      continue;
    }
    if (reTag.test(line)) {
      removed++;
      continue;
    }
    out.push(line);
  }
  return { text: out.join("\n"), removed, unterminated: inRegion };
}

let totalFiles = 0;
let totalLines = 0;
const touched = [];

for (const file of walk(root)) {
  let original;
  try {
    original = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!reRegionStart.test(original) && !reTag.test(original)) continue;

  const { text, removed, unterminated } = cleanContent(original);
  if (unterminated) {
    console.warn(`WARN  ${path.relative(root, file)}: a "#region debug" had no matching "#endregion" — left untouched, inspect manually.`);
    continue;
  }
  if (removed > 0 && text !== original) {
    totalFiles++;
    totalLines += removed;
    touched.push(`${dry ? "would clean" : "cleaned"}  ${path.relative(root, file)}  (-${removed} line${removed === 1 ? "" : "s"})`);
    if (!dry) fs.writeFileSync(file, text);
  }
}

if (touched.length === 0) {
  console.log("No debug instrumentation found. Tree is clean.");
} else {
  console.log(touched.join("\n"));
  console.log(`\n${dry ? "[dry run] " : ""}${totalLines} line(s) across ${totalFiles} file(s).`);
  if (dry) console.log("Re-run without --dry to apply.");
}
