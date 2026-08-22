import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, X } from 'lucide-react';

interface ManualInputModalProps {
  nodeTitle: string;
  onClose: () => void;
  onRun: (value: string) => void;
}

export const ManualInputModal: React.FC<ManualInputModalProps> = ({
  nodeTitle,
  onClose,
  onRun,
}) => {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleRun = () => {
    onRun(draft);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Manual input"
    >
      <div className="w-full max-w-6xl rounded-xl border border-hairline bg-surface-card p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Manual input</h2>
            <p className="mt-1 text-xs text-muted">
              &ldquo;{nodeTitle}&rdquo; has no upstream output available. Enter input for this run only — it is not saved to the workflow.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Cancel"
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-canvas-soft hover:text-ink cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              handleRun();
            }
          }}
          placeholder="Paste or write the input for this run..."
          className="mt-4 min-h-[26rem] w-full resize-y rounded-md border border-hairline bg-surface-card p-4 font-mono text-xs leading-relaxed text-ink shadow-inner outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-pill border border-hairline bg-surface-card text-muted hover:bg-surface-canvas-soft hover:text-ink text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRun}
            className="btn-pilltext-white hover:bg-black/80 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Run
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
