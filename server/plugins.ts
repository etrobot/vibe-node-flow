import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FlowNode, NodeType } from "../App/types";
import type { NodeTextInput } from "../lib/node-io.ts";
import {
  discoverNodePlugins,
  type DiscoveredNodePlugin,
  type NodePluginDiagnostic,
} from "./plugin-discovery.ts";

export type NodeLogFn = (line: string) => void;

export interface NodePluginContext {
  node: FlowNode;
  input: NodeTextInput;
  nodeOutputs: Record<string, string>;
  /** Owning workflow identity and filesystem roots. These are always server-side. */
  workflowId: string;
  /** Unique identity of the current full or single-node execution. */
  runId: string;
  /** Backward-compatible workflow asset root. Generated files belong in assetsDir. */
  workflowDir: string;
  /** Git-syncable definition root containing workflow.json and workflow-owned prompt files. */
  workflowDefinitionDir?: string;
  /** Run-scoped output directory. All generated artifacts belong here. */
  assetsDir: string;
  /** Persistent assets owned by this node and reused across runs. */
  nodeAssetsDir: string;
  /** Stream one console line to the live run UI while the node is still executing. */
  onLog?: NodeLogFn;
}

/** Collect logs and optionally stream each line as soon as it is produced. */
export function createNodeLogger(onLog?: NodeLogFn): {
  logs: string[];
  push: (...lines: string[]) => void;
} {
  const logs: string[] = [];
  return {
    logs,
    push(...lines: string[]) {
      for (const line of lines) {
        const text = String(line);
        logs.push(text);
        if (!onLog) continue;
        try {
          onLog(text);
        } catch (error) {
          console.error("[node-log] listener failed:", error);
        }
      }
    },
  };
}

export interface NodePluginResult {
  output: any;
  logs?: string[];
  /** A node-owned input/validation issue that should be visible but is not an execution crash. */
  status?: "success" | "warning";
  error?: string | null;
}

/**
 * Use these errors when a node has completed its own input or contract check.
 * The workflow engine records them as warnings so sibling branches can still run.
 */
export class NodeWarning extends Error {
  readonly kind: "input" | "validation";

  constructor(message: string, kind: "input" | "validation" = "validation") {
    super(message);
    this.name = "NodeWarning";
    this.kind = kind;
  }
}

export class NodeInputError extends NodeWarning {
  constructor(message: string) {
    super(message, "input");
    this.name = "NodeInputError";
  }
}

export class NodeValidationError extends NodeWarning {
  constructor(message: string) {
    super(message, "validation");
    this.name = "NodeValidationError";
  }
}

export function isNodeWarning(error: unknown): error is NodeWarning {
  return error instanceof NodeWarning
    || (Boolean(error) && typeof error === "object" && (
      (error as { name?: unknown }).name === "NodeWarning"
      || (error as { name?: unknown }).name === "NodeInputError"
      || (error as { name?: unknown }).name === "NodeValidationError"
    ));
}

export interface ServerNodePlugin {
  type: NodeType;
  capabilities?: string[];
  execute(context: NodePluginContext): Promise<NodePluginResult> | NodePluginResult;
}

export interface LoadedNodePlugin extends ServerNodePlugin {
  dirName: string;
  /** Absolute node directory, so a node can ship scripts the host launches. */
  dir: string;
}

const plugins = new Map<NodeType, LoadedNodePlugin>();
const diagnostics: NodePluginDiagnostic[] = [];
const registeredTypes = new Map<NodeType, string>(); // type -> dirName

export interface LoadNodePluginsOptions {
  /** Worker-local registries can stay quiet after the host has logged status. */
  log?: boolean;
}

function moduleCacheKey(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}-${stat.size}`;
  } catch {
    return String(Date.now());
  }
}

export async function loadNodePlugins(
  projectRoot = process.cwd(),
  options: LoadNodePluginsOptions = {},
): Promise<void> {
  plugins.clear();
  diagnostics.length = 0;
  registeredTypes.clear();

  const discovered = discoverNodePlugins(projectRoot);
  diagnostics.push(...discovered.diagnostics);
  if (options.log !== false) {
    for (const diagnostic of diagnostics) {
      console.warn(`[node-plugin] ${diagnostic.dirName}: ${diagnostic.message}`);
    }
  }

  for (const candidate of discovered.plugins) {
    const expectedType = candidate.type;
    const previous = registeredTypes.get(expectedType);
    if (previous) {
      const message = `Node type ${expectedType} already registered by ${previous}`;
      diagnostics.push({ dirName: candidate.dirName, dir: candidate.dir, message });
      if (options.log !== false) console.warn(`[node-plugin] ${candidate.dirName}: ${message}`);
      continue;
    }

    let imported: any;
    try {
      const moduleUrl = pathToFileURL(candidate.serverPath);
      // A cache-busting query lets the development watcher reload an edited
      // node module without restarting the host process.
      moduleUrl.searchParams.set("v", moduleCacheKey(candidate.serverPath));
      imported = await import(moduleUrl.href);
    } catch (error) {
      const message = `server.ts load failed: ${error instanceof Error ? error.message : String(error)}`;
      diagnostics.push({ dirName: candidate.dirName, dir: candidate.dir, message });
      if (options.log !== false) console.warn(`[node-plugin] ${candidate.dirName}: ${message}`);
      continue;
    }

    const plugin = (imported.default || imported.plugin || imported) as Partial<ServerNodePlugin> | undefined;
    if (
      !plugin ||
      typeof plugin !== "object" ||
      typeof plugin.type !== "string" ||
      typeof plugin.execute !== "function"
    ) {
      const message = "server.ts default export must be an object with type and execute(context)";
      diagnostics.push({ dirName: candidate.dirName, dir: candidate.dir, message });
      if (options.log !== false) console.warn(`[node-plugin] ${candidate.dirName}: ${message}`);
      continue;
    }

    if (plugin.type !== expectedType) {
      const message = `server.ts type "${plugin.type}" does not match node.json "${expectedType}"`;
      diagnostics.push({ dirName: candidate.dirName, dir: candidate.dir, message });
      if (options.log !== false) console.warn(`[node-plugin] ${candidate.dirName}: ${message}`);
      continue;
    }

    registeredTypes.set(expectedType, candidate.dirName);
    const capabilities = Array.isArray(plugin.capabilities)
      ? plugin.capabilities.filter((capability): capability is string => typeof capability === "string")
      : undefined;
    plugins.set(expectedType, {
      type: expectedType,
      execute: plugin.execute,
      capabilities,
      dirName: candidate.dirName,
      dir: candidate.dir,
    });
    if (options.log !== false) {
      console.log(`[node-plugin] loaded ${expectedType} from nodes/${candidate.dirName}`);
    }
  }
}

/**
 * Watch the node directory and refresh the server registry when a node is
 * added, removed, or edited. The watcher is host-only; Workers still load a
 * clean snapshot of the registry for each execution.
 */
export function watchNodePlugins(
  projectRoot = process.cwd(),
  options: LoadNodePluginsOptions = {},
): () => void {
  const nodesRoot = path.resolve(projectRoot, "nodes");
  if (!fs.existsSync(nodesRoot)) return () => undefined;

  const watchers = new Map<string, fs.FSWatcher>();
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  let reloadPromise: Promise<void> | null = null;
  let reloadQueued = false;

  const reload = async () => {
    if (reloadPromise) {
      reloadQueued = true;
      return reloadPromise;
    }
    reloadPromise = loadNodePlugins(projectRoot, options).finally(() => {
      reloadPromise = null;
      if (reloadQueued) {
        reloadQueued = false;
        void reload();
      }
    });
    return reloadPromise;
  };

  const scheduleReload = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      refreshDirectoryWatchers();
      void reload().catch((error) => {
        console.error("[node-plugin] hot reload failed:", error);
      });
    }, 100);
    reloadTimer.unref?.();
  };

  const watchDirectory = (directory: string) => {
    if (watchers.has(directory)) return;
    try {
      const watcher = fs.watch(directory, { persistent: false }, scheduleReload);
      watcher.on("error", (error) => {
        console.warn(`[node-plugin] watcher error for ${directory}: ${error.message}`);
      });
      watchers.set(directory, watcher);
    } catch (error) {
      console.warn(`[node-plugin] cannot watch ${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const refreshDirectoryWatchers = () => {
    watchDirectory(nodesRoot);
    for (const entry of fs.readdirSync(nodesRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_")) {
        watchDirectory(path.join(nodesRoot, entry.name));
      }
    }
  };

  refreshDirectoryWatchers();
  return () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}

export function getNodePlugin(type: NodeType): LoadedNodePlugin | undefined {
  return plugins.get(type);
}

export function nodePluginHasCapability(type: NodeType, capability: string): boolean {
  return plugins.get(type)?.capabilities?.includes(capability) ?? false;
}

/**
 * Absolute path to an executable a node ships alongside its code, or null when
 * the node does not provide one.
 *
 * This is how a node hands the host something to run without the host having to
 * know what it is. The alternative — a `package.json` script the host declares
 * on the node's behalf — inverts the dependency: uninstalling the node would
 * leave a dangling command, and two nodes could not both own "the render step".
 * Here the host only asks "does this node ship <name>?".
 *
 * `name` is a bare file name by construction: any path separator is refused, so
 * a manifest cannot walk out of its own directory.
 */
export function nodePluginScript(type: NodeType, name: string): string | null {
  if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) return null;
  const plugin = plugins.get(type);
  if (!plugin) return null;
  const candidate = path.join(plugin.dir, name);
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

export function listNodePlugins(): Array<
  Pick<LoadedNodePlugin, "type" | "dirName">
> {
  return [...plugins.values()].map(({ type, dirName }) => ({
    type,
    dirName,
  }));
}

export function listNodePluginDiagnostics(): NodePluginDiagnostic[] {
  return [...diagnostics];
}
