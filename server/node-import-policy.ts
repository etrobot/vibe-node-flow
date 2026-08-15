import fs from "node:fs";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const TEST_FILE = /(?:^|[.])(?:test|spec)[.][^.]+$/;

export interface CrossNodeImportViolation {
  fromNode: string;
  fromFile: string;
  toNode: string | null;
  toFile: string;
  specifier: string;
  targetKind: "node" | "workflow";
}

function isSourceFile(file: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(file)) && !TEST_FILE.test(path.basename(file));
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(directory)) return files;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(file));
    else if (entry.isFile() && isSourceFile(file)) files.push(file);
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  // This intentionally handles only statically resolvable imports. Bare package
  // imports are not node-to-node dependencies and dynamic expressions cannot
  // be proven safe by a source scan.
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bexport\s+(?:[\s\S]*?\s+from\s*)["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const result = new Set<string>();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) result.add(match[1]);
  }
  return [...result];
}

function resolveImport(projectRoot: string, fromFile: string, specifier: string): string | null {
  const isRelative = specifier.startsWith(".");
  const isProjectAlias = specifier.startsWith("@/");
  if (!isRelative && !isProjectAlias) return null;
  const withoutQuery = specifier.split(/[?#]/, 1)[0];
  const base = isProjectAlias
    ? path.resolve(projectRoot, withoutQuery.slice(2))
    : path.resolve(path.dirname(fromFile), withoutQuery);
  const candidates = [base];
  if (!path.extname(base)) {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${base}${extension}`);
    for (const extension of SOURCE_EXTENSIONS) candidates.push(path.join(base, `index${extension}`));
  }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
    } catch {
      // An unresolved optional import is left to the normal module loader.
    }
  }
  return null;
}

function nodeOwner(nodesRoot: string, file: string): string | null {
  const relative = path.relative(nodesRoot, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [owner] = relative.split(path.sep);
  return owner || null;
}

function formatFile(nodesRoot: string, file: string): string {
  return path.relative(nodesRoot, file) || file;
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Find node imports that cross into another node or into workflow code. */
export function findCrossNodeImports(projectRoot = process.cwd()): CrossNodeImportViolation[] {
  const nodesRoot = path.resolve(projectRoot, "nodes");
  const workflowsRoot = path.resolve(projectRoot, "workflows");
  if (!fs.existsSync(nodesRoot)) return [];

  const violations: CrossNodeImportViolation[] = [];
  for (const entry of fs.readdirSync(nodesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const nodeDir = path.join(nodesRoot, entry.name);
    for (const fromFile of sourceFiles(nodeDir)) {
      const fromNode = nodeOwner(nodesRoot, fromFile);
      if (!fromNode) continue;
      const source = fs.readFileSync(fromFile, "utf8");
      for (const specifier of importSpecifiers(source)) {
        const toFile = resolveImport(projectRoot, fromFile, specifier);
        if (!toFile) continue;
        const toNode = nodeOwner(nodesRoot, toFile);
        if (toNode && toNode !== fromNode) {
          violations.push({
            fromNode,
            fromFile: formatFile(nodesRoot, fromFile),
            toNode,
            toFile: formatFile(projectRoot, toFile),
            specifier,
            targetKind: "node",
          });
        } else if (isInside(workflowsRoot, toFile)) {
          violations.push({
            fromNode,
            fromFile: formatFile(nodesRoot, fromFile),
            toNode: null,
            toFile: formatFile(projectRoot, toFile),
            specifier,
            targetKind: "workflow",
          });
        }
      }
    }
  }

  return violations.sort((a, b) => (
    `${a.fromFile}:${a.toFile}`.localeCompare(`${b.fromFile}:${b.toFile}`)
  ));
}

export function formatCrossNodeImportViolation(violation: CrossNodeImportViolation): string {
  const label = violation.targetKind === "workflow" ? "workflow code" : "another node";
  return `Node import is not allowed: ${violation.fromFile} imports ${label} ${violation.toFile} (${violation.specifier})`;
}
