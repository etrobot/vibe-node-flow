import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.ts";

/**
 * The prompt framework is user-authored content. Keep the loader server-side
 * so a workflow can use the exact markdown file supplied with the project
 * without duplicating a several-thousand-token prompt in every node.
 */
const FALLBACK_FRAMEWORK = `
You must convert the confirmed script into timeline JSON. Output only JSON, no Markdown or explanations.
The top level can only contain title, global-components, clips; each clip can only contain speech, shots.
Allowed components: text-typing, rolling-number, flow, loopflow, text-lines, structure, story, clock, linechart, meme, logo.
flow, loopflow, text-lines, structure, story must first define a unique English key in global-components, then be referenced by shot using the key and a semantically matching spot.
speech must come verbatim from the narration text; only **complete phrases** are shot-change anchors, and the number of anchors must equal the number of shots minus one.
text-typing can only be the first shot of a clip; clock is only for narration with explicit time semantics; numbers, trends, emotions, and brands each use their corresponding components.
The visuals should have camera rhythm and motion variation; do not output web UI, PPT, dashboards, or extra fields.
`.trim();

function candidatePaths(_workflowRoot?: string): string[] {
  const configured = process.env.VIDEO_PROMPT_FILE?.trim();
  return [
    configured,
    path.join(DATA_DIR, "video-prompt.md"),
    path.join(process.cwd(), "prompts", "video-prompt.md"),
  ].filter((value): value is string => Boolean(value));
}

/** Read the exact framework, falling back to a compact local contract. */
export function getVideoPromptFramework(workflowRoot?: string): string {
  for (const candidate of candidatePaths(workflowRoot)) {
    try {
      const text = fs.readFileSync(candidate, "utf8").trim();
      if (text) return text;
    } catch {
      // Try the next location; a deploy may intentionally omit the local file.
    }
  }
  return FALLBACK_FRAMEWORK;
}

/**
 * Marker understood by the validated-generation extension. Keeping this function here makes
 * the marker discoverable to CLI callers and avoids accidental spelling drift.
 */
export const VIDEO_PROMPT_MARKER = "{{VIDEO_PROMPT_FRAMEWORK}}";

export function buildTimelinePrompt(confirmedScript: string, topic?: string): string {
  const topicLine = topic?.trim() ? `\nTopic: ${topic.trim()}\n` : "";
  return [
    "You are a timeline visual script director.",
    "Strictly follow the video-prompt framework below to convert the confirmed script into a renderable timeline JSON.",
    "Do not output Markdown code fences, comments, or any explanations.",
    topicLine,
    VIDEO_PROMPT_MARKER,
    "\nConfirmed script:\n",
    confirmedScript,
  ].join("\n");
}
