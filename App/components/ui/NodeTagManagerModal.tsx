import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, LockKeyhole, Plus, Tags, Trash2, X } from 'lucide-react';
import {
  MAX_NODE_TAG_LENGTH,
  getNodeTagColors,
  isDefaultNodeTag,
  normalizeNodeTag,
} from '@/lib/workflow-tags';

interface NodeTagManagerModalProps {
  nodeTitle: string;
  catalog: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  onDeleteTag: (tag: string) => void;
  onClose: () => void;
}

export const NodeTagManagerModal: React.FC<NodeTagManagerModalProps> = ({
  nodeTitle,
  catalog,
  selectedTags,
  onToggleTag,
  onAddTag,
  onDeleteTag,
  onClose,
}) => {
  const [newTag, setNewTag] = useState('');
  const selectedKeys = useMemo(
    () => new Set(selectedTags.map((tag) => tag.toLocaleLowerCase())),
    [selectedTags],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedTag = normalizeNodeTag(newTag);
    if (!normalizedTag) return;
    onAddTag(normalizedTag);
    setNewTag('');
  };

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Manage global tags for ${nodeTitle}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md card-panel overflow-hidden flex flex-col">
        <div className="panel-header">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2.5 rounded-md border border-hairline bg-surface-canvas text-primary-text">
              <Tags className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-ink">Global operation tags</h3>
              <p className="text-[11px] text-muted truncate">{nodeTitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost" aria-label="Close tag manager">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-xs leading-relaxed text-muted">
            Mark capabilities used outside the DAG, such as databases, environment variables,
            file systems, or CRM access. Tags do not create edges or change execution order.
          </p>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-ink">Available tags</label>
              <span className="text-[10px] font-mono text-muted">{selectedTags.length} selected</span>
            </div>
            <div className="flex flex-wrap gap-2 rounded-xl border border-hairline bg-surface-canvas p-2">
              {catalog.map((tag) => {
                const colors = getNodeTagColors(tag);
                const isSelected = selectedKeys.has(tag.toLocaleLowerCase());
                const isBuiltIn = isDefaultNodeTag(tag);
                return (
                  <div key={tag.toLocaleLowerCase()} className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => onToggleTag(tag)}
                      title={isSelected ? `Remove ${tag} from this node` : `Add ${tag} to this node`}
                      className={`h-8 inline-flex items-center gap-1.5 px-2.5 border text-[11px] font-medium transition-all cursor-pointer ${
                        isBuiltIn ? 'rounded-md' : 'rounded-l-lg'
                      } ${isSelected ? 'ring-2 ring-black/10 shadow-2xs' : 'opacity-70 hover:opacity-100'}`}
                      style={{
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.foreground,
                      }}
                    >
                      <span>{tag}</span>
                      {isSelected ? (
                        <Check className="w-3 h-3" />
                      ) : isBuiltIn ? (
                        <LockKeyhole className="w-2.5 h-2.5 opacity-60" />
                      ) : null}
                    </button>
                    {!isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => onDeleteTag(tag)}
                        title={`Delete ${tag} from the global catalog`}
                        aria-label={`Delete ${tag}`}
                        className="h-8 px-2 rounded-r-lg border border-l-0 transition-colors cursor-pointer hover:brightness-95"
                        style={{
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.foreground,
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <form onSubmit={handleAdd}>
            <label htmlFor="new-global-node-tag" className="block text-xs font-medium text-ink mb-2">
              Add a reusable tag
            </label>
            <div className="flex items-center gap-2">
              <input
                id="new-global-node-tag"
                type="text"
                value={newTag}
                maxLength={MAX_NODE_TAG_LENGTH}
                onChange={(event) => setNewTag(event.target.value)}
                placeholder="e.g. CRM"
                className="input-pill flex-1"
                autoFocus
              />
              <button
                type="submit"
                disabled={!normalizeNodeTag(newTag)}
                className="btn-pill text-xs borderinline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-muted">New tags are shared by every node in this workflow.</p>
          </form>
        </div>

        <div className="flex justify-end px-5 py-3.5 border-t border-hairline-soft bg-surface-card">
          <button
            type="button"
            onClick={onClose}
            className="btn-pill text-xs border border-black"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
