import fs from "node:fs";
import path from "node:path";

export interface DiscoveredNodePlugin {
  dir: string; // absolute node directory
  dirName: string; // folder name, used only as a label / diagnostic key
  type: string; // canonical node type declared in node.json
  clientPath: string; // absolute path to client.tsx
  serverPath: string; // absolute path to server.ts
}

export interface NodePluginDiagnostic {
  dirName: string;
  dir: string;
  message: string;
}

export interface NodePluginDiscoveryResult {
  plugins: DiscoveredNodePlugin[];
  diagnostics: NodePluginDiagnostic[];
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function entryPath(dir: string, file: string): string | null {
  const resolved = path.join(dir, file);
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

// Read the canonical node type from a directory's required node.json. A node
// directory must declare its type here exactly once; both client.tsx and
// server.ts are validated against it. This is a single-key stub, not an npm
// package manifest — it only pins the type string to catch copy-paste typos.
function readCanonicalType(dir: string): { type: string } | { error: string } {
  const manifestPath = path.join(dir, "node.json");
  if (!fs.existsSync(manifestPath)) {
    return { error: "Missing node.json (declare { \"type\": \"your.node.type\" })" };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { error: `node.json parse failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const type = typeof parsed?.type === "string" ? parsed.type.trim() : "";
  if (!type) {
    return { error: 'node.json must contain a non-empty string field "type"' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(type)) {
    return { error: `node.json type "${type}" contains invalid characters` };
  }
  return { type };
}

/**
 * Discover node plugins by scanning the host project's `nodes/` directory.
 * Each direct subdirectory of `nodes/` must contain `node.json`, `client.tsx`,
 * and `server.ts` to be a node.
 */
export function discoverNodePlugins(projectRoot = process.cwd()): NodePluginDiscoveryResult {
  const plugins: DiscoveredNodePlugin[] = [];
  const diagnostics: NodePluginDiagnostic[] = [];
  const nodesRoot = path.resolve(projectRoot, "nodes");

  if (!isDirectory(nodesRoot)) {
    return { plugins, diagnostics };
  }

  const entries = fs.readdirSync(nodesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const dir = path.join(nodesRoot, entry.name);
    if (!isDirectory(dir)) continue;

    const record = (message: string) => diagnostics.push({ dirName: entry.name, dir, message });
    const clientPath = entryPath(dir, "client.tsx");
    const serverPath = entryPath(dir, "server.ts");

    const missing: string[] = [];
    if (!clientPath) missing.push("client.tsx");
    if (!serverPath) missing.push("server.ts");
    const typeResult = readCanonicalType(dir);
    let type: string | null = null;
    if ("type" in typeResult) {
      type = typeResult.type;
    } else {
      missing.push(typeResult.error);
    }

    if (missing.length) {
      record(`Incomplete node: ${missing.join("; ")}, skipped directory`);
      continue;
    }

    plugins.push({
      dir,
      dirName: entry.name,
      type: type!,
      clientPath: clientPath!,
      serverPath: serverPath!,
    });
  }

  // Stable order by folder name so log output and menu ordering are deterministic.
  plugins.sort((a, b) => a.dirName.localeCompare(b.dirName));
  return { plugins, diagnostics };
}
