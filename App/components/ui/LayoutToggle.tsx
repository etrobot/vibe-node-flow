import React from 'react';
import { Workflow, PanelsTopLeft } from 'lucide-react';
import type { WorkspaceLayout } from '../../utils/workspace-layout';

interface LayoutToggleProps {
  layout: WorkspaceLayout;
  onChange: (layout: WorkspaceLayout) => void;
}

export const LayoutToggle: React.FC<LayoutToggleProps> = ({ layout, onChange }) => {
  return (
    <div
      className="flex items-center gap-0.5 bg-surface-card rounded-md p-0.5 border border-hairline"
      role="group"
      aria-label="Workspace layout"
    >
      <button
        type="button"
        title="Canvas layout"
        aria-label="Canvas layout"
        aria-pressed={layout === 'canvas'}
        onClick={() => onChange('canvas')}
        className={`grid place-items-center w-7 h-7 rounded-sm transition-all cursor-pointer ${
          layout === 'canvas'
            ? 'bg-primary text-on-primary shadow-sm'
            : 'text-muted hover:text-ink hover:bg-surface-canvas-soft'
        }`}
      >
        <Workflow className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        title="App layout"
        aria-label="App layout"
        aria-pressed={layout === 'app'}
        onClick={() => onChange('app')}
        className={`grid place-items-center w-7 h-7 rounded-sm transition-all cursor-pointer ${
          layout === 'app'
            ? 'bg-primary text-on-primary shadow-sm'
            : 'text-muted hover:text-ink hover:bg-surface-canvas-soft'
        }`}
      >
        <PanelsTopLeft className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
