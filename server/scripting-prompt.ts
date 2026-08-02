import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.ts";

const FALLBACK_FRAMEWORK = `
Based on the topic and facts provided upstream, first output a three-column table, then separately output --- and a natural conversational narration.
Only use facts explicitly present upstream; do not fabricate data, sources, or cases.`.trim();

function candidatePaths(_workflowRoot?: string): string[] {
  const configured = process.env.SCRIPTING_PROMPT_FILE?.trim();
  return [
    configured,
    path.join(DATA_DIR, "scripting-prompt.md"),
    path.join(process.cwd(), "prompts", "scripting-prompt.md"),
  ].filter((value): value is string => Boolean(value));
}

/** Load the user-authored script framework at execution time. */
export function getScriptingPromptFramework(workflowRoot?: string): string {
  for (const candidate of candidatePaths(workflowRoot)) {
    try {
      const text = fs.readFileSync(candidate, "utf8").trim();
      if (text) return text;
    } catch {
      // Try the next configured location.
    }
  }
  return FALLBACK_FRAMEWORK;
}

export const SCRIPTING_PROMPT_MARKER = "{{SCRIPTING_PROMPT_FRAMEWORK}}";
