import fs from "node:fs";
import path from "node:path";

/** UI metadata declared in node.json; used when client.tsx is absent. */
export interface NodeManifest {
  type: string;
  label?: string;
  menuLabel?: string;
  description?: string;
  icon?: string;
  color?: string;
  menuOrder?: number;
  availableInMenu?: boolean;
}

export interface DiscoveredNodePlugin {
  dir: string; // absolute node directory
  dirName: string; // folder name, used only as a label / diagnostic key
  type: string; // canonical node type declared in node.json
  manifest: NodeManifest;
  /** Absolute path to client.tsx when the node ships a browser module. */
  clientPath: string | null;
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

export function defaultLabelFromDirName(dirName: string): string {
  return dirName
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Read the canonical node manifest from node.json. A node directory must declare
// its type here exactly once; server.ts is validated against it. client.tsx is
// optional — when absent the host uses manifest metadata and the unified panel.
function readNodeManifest(dir: string, dirName: string): { manifest: NodeManifest } | { error: string } {
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

  const manifest: NodeManifest = { type };
  if (typeof parsed.label === "string" && parsed.label.trim()) manifest.label = parsed.label.trim();
  if (typeof parsed.menuLabel === "string" && parsed.menuLabel.trim()) manifest.menuLabel = parsed.menuLabel.trim();
  if (typeof parsed.description === "string") manifest.description = parsed.description;
  if (typeof parsed.icon === "string" && parsed.icon.trim()) manifest.icon = parsed.icon.trim();
  if (typeof parsed.color === "string" && parsed.color.trim()) manifest.color = parsed.color.trim();
  if (Number.isFinite(Number(parsed.menuOrder))) manifest.menuOrder = Number(parsed.menuOrder);
  if (typeof parsed.availableInMenu === "boolean") manifest.availableInMenu = parsed.availableInMenu;

  if (!manifest.label) {
    manifest.label = defaultLabelFromDirName(dirName);
  }

  return { manifest };
}

/**
 * Discover node plugins by scanning the host project's `nodes/` directory.
 * Each direct subdirectory of `nodes/` must contain `node.json` and `server.ts`.
 * `client.tsx` is optional; without it the host uses node.json metadata and the
 * unified inspector panel.
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
    if (!serverPath) missing.push("server.ts");
    const manifestResult = readNodeManifest(dir, entry.name);
    let manifest: NodeManifest | null = null;
    if ("manifest" in manifestResult) {
      manifest = manifestResult.manifest;
    } else {
      missing.push(manifestResult.error);
    }

    if (missing.length) {
      record(`Incomplete node: ${missing.join("; ")}, skipped directory`);
      continue;
    }

    plugins.push({
      dir,
      dirName: entry.name,
      type: manifest!.type,
      manifest: manifest!,
      clientPath,
      serverPath: serverPath!,
    });
  }

  // Stable order by folder name so log output and menu ordering are deterministic.
  plugins.sort((a, b) => a.dirName.localeCompare(b.dirName));
  return { plugins, diagnostics };
}
