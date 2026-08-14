import React, { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';
import { applyTheme, getThemeId, themes } from '../../themes';

export const ThemeSelector: React.FC = () => {
  const [themeId, setThemeId] = useState(getThemeId);
  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);
  return (
    <label className="flex items-center gap-1 text-muted" title="Choose theme">
      <Palette className="w-3.5 h-3.5" />
      <select
        aria-label="Theme"
        value={themeId}
        onChange={(e) => setThemeId(e.target.value)}
        className="bg-surface-card border border-hairline rounded-md px-1.5 py-1 text-[11px] text-ink cursor-pointer"
      >
        {Object.entries(themes).map(([id, value]) => (
          <option key={id} value={id}>{value.name.replace('-design-analysis', '')}</option>
        ))}
      </select>
    </label>
  );
};
