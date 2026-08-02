import fs from "node:fs";
import path from "node:path";

// Root data directory (git-ignored). Runtime assets, DB, prompts live here.
export const DATA_DIR = process.env.VIBE_NODE_FLOW_DATA_DIR?.trim()
  ? path.resolve(process.env.VIBE_NODE_FLOW_DATA_DIR.trim())
  : path.join(process.cwd(), "data");

// Workflow definitions directory (git-syncable). Lives at project root so
// data/ can be entirely git-ignored.
export const WORKFLOWS_DIR = process.env.VIBE_NODE_FLOW_DIR?.trim()
  ? path.resolve(process.env.VIBE_NODE_FLOW_DIR.trim())
  : path.join(process.cwd(), "workflows");
export const ASSETS_DIR = path.join(DATA_DIR, "assets");
export const DB_PATH = path.join(DATA_DIR, "studio.db");

export function ensureDataDirs(): void {
  fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Workflow / node ids are generated internally, but guard against path traversal
// before they ever touch the filesystem.
export function assertSafeId(id: string): string {
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id) || id.includes("..")) {
    throw new Error(`Invalid ID: ${JSON.stringify(id)}`);
  }
  return id;
}

/** Workflow definition directory: workflow.json, schedule.json (git-syncable). */
export function workflowDir(id: string): string {
  return path.join(WORKFLOWS_DIR, assertSafeId(id));
}

/** Root directory for all generated/asset content for a workflow (gitignored). */
export function workflowAssetRoot(id: string): string {
  return path.join(ASSETS_DIR, assertSafeId(id));
}

export function workflowAssetsDir(id: string): string {
  return path.join(workflowAssetRoot(id), "assets");
}

export function workflowGeneratedAssetsDir(id: string): string {
  return path.join(workflowAssetsDir(id), "generated");
}

export function workflowAssetDir(id: string, assetId: string): string {
  return path.join(workflowGeneratedAssetsDir(id), assertSafeId(assetId));
}

export function workflowScheduleFile(id: string): string {
  return path.join(workflowDir(id), "schedule.json");
}
