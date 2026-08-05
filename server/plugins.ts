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
      imported = await import(pathToFileURL(candidate.serverPath).href);
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
