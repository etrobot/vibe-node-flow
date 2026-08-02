/** The only payload shapes allowed to cross workflow edges. */
export type NodeTextInput = Record<string, string>;

/** Preserve text as-is; serialize every other node output into text. */
export function nodeOutputToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

/**
 * Always return a stable object keyed by upstream node id, with text-only
 * values. No parents therefore produce an empty object.
 */
export function combineNodeInputs(
  entries: Array<{ key: string; value: unknown }>,
): NodeTextInput {
  return Object.fromEntries(
    entries.map((entry) => [entry.key, nodeOutputToText(entry.value)]),
  );
}

/** Normalize caller-supplied single-node debug input to the edge contract. */
export function normalizeNodeInput(value: unknown): NodeTextInput {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Node input must be an object keyed by upstream node id");
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      nodeOutputToText(item),
    ]),
  );
}

/** Read the text from a node that requires exactly one upstream. */
export function singleNodeInputText(input: NodeTextInput): string {
  const keys = Object.keys(input);
  if (keys.length !== 1) {
    throw new Error(`Expected exactly one upstream node; received ${keys.length}.`);
  }
  return input[keys[0]];
}
