import vm from "node:vm";

/**
 * Small, host-provided runtime helpers that are useful to node extensions.
 * Keeping these outside the workflow engine means an extension owns its
 * execution policy while the engine only orchestrates the graph.
 */

export function safeStringify(value: any, indent = 0): string {
  try {
    return JSON.stringify(value, null, indent);
  } catch {
    return String(value);
  }
}

export interface ScriptResult {
  output: any;
  logs: string[];
}

/** Execute a node-owned JavaScript body in the same sandbox as the script node. */
export async function runScript(
  code: string,
  input: string,
  nodeOutputs: Record<string, string>,
  upstream = "",
): Promise<ScriptResult> {
  const logs: string[] = [];
  const format = (args: any[]) =>
    args
      .map((value) => (typeof value === "object" ? safeStringify(value) : String(value)))
      .join(" ");

  const sandboxConsole = {
    log: (...args: any[]) => logs.push(format(args)),
    error: (...args: any[]) => logs.push("[Error] " + format(args)),
    warn: (...args: any[]) => logs.push("[Warn] " + format(args)),
    info: (...args: any[]) => logs.push(format(args)),
  };

  const context = vm.createContext({
    input,
    $upstream: upstream,
    $nodes: nodeOutputs,
    console: sandboxConsole,
  });

  const wrapped = `(async () => {\n${code || "return input;"}\n})()`;
  try {
    // Keep the legacy filename in diagnostics so existing workflows and
    // integrations that surface sandbox errors remain readable.
    const script = new vm.Script(wrapped, { filename: "script-node.js" });
    // This bounds synchronous work. Promise-based extension code remains the
    // extension's responsibility and can still be awaited by the caller.
    const result = await script.runInContext(context, { timeout: 15000 });
    return { output: result === undefined ? null : result, logs };
  } catch (error: any) {
    const wrappedError = new Error(`Script execution error: ${error?.message || String(error)}`);
    (wrappedError as any).logs = logs;
    throw wrappedError;
  }
}
