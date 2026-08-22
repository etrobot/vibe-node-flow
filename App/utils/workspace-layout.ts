export type WorkspaceLayout = 'canvas' | 'app';

export const WORKSPACE_LAYOUT_STORAGE_KEY = 'genno-workspace-layout';
export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = 'canvas';

export function isWorkspaceLayout(value: unknown): value is WorkspaceLayout {
  return value === 'canvas' || value === 'app';
}

export function readWorkspaceLayout(): WorkspaceLayout {
  try {
    const stored = localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    console.log('[workspace-layout] localStorage get', WORKSPACE_LAYOUT_STORAGE_KEY, stored);
    if (isWorkspaceLayout(stored)) return stored;
  } catch (err) {
    console.error('[workspace-layout] localStorage get failed', err);
  }
  return DEFAULT_WORKSPACE_LAYOUT;
}

export function writeWorkspaceLayout(layout: WorkspaceLayout): void {
  try {
    localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, layout);
    const verified = localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    if (verified !== layout) {
      console.error('[workspace-layout] localStorage write mismatch', {
        expected: layout,
        actual: verified,
      });
      return;
    }
    console.log('[workspace-layout] localStorage set', WORKSPACE_LAYOUT_STORAGE_KEY, layout);
  } catch (err) {
    console.error('[workspace-layout] localStorage set failed', layout, err);
  }
}
