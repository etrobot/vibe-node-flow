/**
 * Run-asset contract for the verified upstream brief.
 * clip-storyboard writes once under the run directory; downstream nodes re-read
 * by the same relative path via `readSourceBrief`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** Canonical relative path under a run's assetsDir. */
export const SOURCE_BRIEF_ASSET = 'source-brief.md';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveUnderAssets(assetsDir: string, relativeFile: string, label: string): string {
  const root = path.resolve(assetsDir);
  const target = path.resolve(root, relativeFile);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes the run asset directory: ${relativeFile}`);
  }
  return target;
}

/** Persist the verified upstream brief and return the relative edge reference. */
export async function writeSourceBriefAsset(assetsDir: string, brief: string): Promise<string> {
  const text = clean(brief);
  if (!text) throw new Error('Cannot write an empty source brief asset.');
  await fs.mkdir(assetsDir, { recursive: true });
  const relative = SOURCE_BRIEF_ASSET;
  await fs.writeFile(resolveUnderAssets(assetsDir, relative, 'source brief'), `${text}\n`, 'utf8');
  return relative;
}

export interface SourceBriefCarrier {
  sourceBriefPath?: unknown;
  sourceBrief?: unknown;
}

/**
 * Prefer `sourceBriefPath` (file under assetsDir). Fall back to legacy embedded
 * `sourceBrief` so older run history still works.
 */
export async function readSourceBrief(
  carrier: SourceBriefCarrier | null | undefined,
  assetsDir: string,
): Promise<string> {
  const relative = clean(carrier?.sourceBriefPath);
  if (relative) {
    try {
      return (await fs.readFile(resolveUnderAssets(assetsDir, relative, 'source brief'), 'utf8')).trim();
    } catch (error) {
      throw new Error(
        `sourceBriefPath ${JSON.stringify(relative)} could not be read: `
        + (error instanceof Error ? error.message : String(error)),
      );
    }
  }
  return clean(carrier?.sourceBrief);
}

/** Drop prompt-sized brief text from a document copy; keep the path reference. */
export function stripEmbeddedSourceBrief<T extends Record<string, any>>(document: T): T {
  const copy = structuredClone(document);
  delete copy.sourceBrief;
  return copy;
}
