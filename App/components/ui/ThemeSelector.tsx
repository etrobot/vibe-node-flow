import React, { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { applyTheme, getThemeId, themes } from '../../themes';

function themeLabel(name: string): string {
  return name.replace('-design-analysis', '');
}

export const ThemeSelector: React.FC = () => {
  const [themeId, setThemeId] = useState(getThemeId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectTheme = (id: string) => {
    console.log('[theme] select', id);
    setThemeId(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="Choose theme"
        aria-label="Choose theme"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
        className="grid place-items-center w-7 h-7 rounded-sm border border-hairline bg-surface-card text-muted hover:text-ink hover:bg-surface-canvas-soft transition-all cursor-pointer"
      >
        <Palette className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Theme"
          className="absolute right-0 top-full mt-1.5 z-50 min-w-[9.5rem] card-panel py-1 shadow-lg border border-hairline"
        >
          {Object.entries(themes).map(([id, value]) => {
            const selected = id === themeId;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectTheme(id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                  selected
                    ? 'bg-surface-canvas-soft text-ink font-medium'
                    : 'text-body hover:bg-surface-canvas-soft hover:text-ink'
                }`}
              >
                <span>{themeLabel(value.name)}</span>
                {selected ? <Check className="w-3.5 h-3.5 shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
