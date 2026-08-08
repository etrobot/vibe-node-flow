import React, { useState, useEffect } from 'react';
import { renderLucideIcon } from './IconPicker';
import { X, Check, Search, Palette } from 'lucide-react';

export const ALL_ICONS = [
  'Sparkles', 'Bot', 'Code', 'Terminal', 'Zap', 'CheckCircle', 'FileText', 'Database',
  'ShieldCheck', 'Cpu', 'FileJson', 'Wand2', 'Binary', 'Layers', 'Search', 'MessageSquare',
  'Braces', 'Flame', 'Globe', 'Mail', 'Send', 'Filter', 'Hash', 'RefreshCw', 'Sliders',
  'Box', 'HardDrive', 'Key', 'Link', 'Share2', 'Tag', 'User', 'Webhook', 'Workflow',
  'Compass', 'Eye', 'Settings', 'Activity', 'Grid', 'Shield', 'PieChart', 'Radio',
  'Server', 'Download', 'Upload',
];

export const PRESET_COLORS = [
  { label: 'Cursor Orange', hex: '#f54e00' },
  { label: 'Orange Active', hex: '#d04200' },
  { label: 'Ink', hex: '#26251e' },
  { label: 'Body', hex: '#5a5852' },
  { label: 'Success Green', hex: '#1f8a65' },
  { label: 'Error Red', hex: '#cf2d56' },
  { label: 'Warning Gold', hex: '#c08532' },
  { label: 'Lavender', hex: '#c0a8dd' },
  { label: 'Pastel Blue', hex: '#9fbbe0' },
  { label: 'Mint', hex: '#9fc9a2' },
];

interface IconPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentIcon: string;
  currentColor?: string;
  onSave: (icon: string, color: string) => void;
  subjectLabel?: string;
}

export const IconPickerModal: React.FC<IconPickerModalProps> = ({
  isOpen, onClose, currentIcon, currentColor = '#f54e00', onSave, subjectLabel = 'Node',
}) => {
  const [selectedIcon, setSelectedIcon] = useState(currentIcon);
  const [selectedColor, setSelectedColor] = useState(currentColor);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen) { setSelectedIcon(currentIcon); setSelectedColor(currentColor || '#f54e00'); setSearchQuery(''); }
  }, [isOpen, currentIcon, currentColor]);

  if (!isOpen) return null;

  const filteredIcons = ALL_ICONS.filter((icon) => icon.toLowerCase().includes(searchQuery.toLowerCase().trim()));
  const handleConfirm = () => { onSave(selectedIcon, selectedColor); onClose(); };

  return (
    <div className="modal-overlay">
      <div className="w-full max-w-lg card-panel overflow-hidden flex flex-col max-h-[85vh]">
        <div className="panel-header">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg border flex items-center justify-center transition-all"
              style={{ backgroundColor: `${selectedColor}15`, borderColor: `${selectedColor}30`, color: selectedColor }}>
              {renderLucideIcon(selectedIcon, 'w-5 h-5')}
            </div>
            <div>
              <h3 className="text-base font-medium text-ink">{subjectLabel} Icon & Color</h3>
              <p className="text-xs text-muted">Choose a theme icon and color</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div>
            <label className="block text-xs font-medium text-ink mb-2 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-primary" /> Choose {subjectLabel} Color
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map((preset) => {
                const isSelected = selectedColor.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button key={preset.hex} type="button" onClick={() => setSelectedColor(preset.hex)} title={preset.label}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${isSelected ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: preset.hex }}>
                    {isSelected && <Check className="w-4 h-4 text-white drop-shadow-xs" />}
                  </button>
                );
              })}
              <div className="flex items-center gap-1.5 ml-2 border-l border-hairline pl-3">
                <input type="color" value={selectedColor} onChange={(e) => setSelectedColor(e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent p-0" title="Custom Hex color" />
                <input type="text" value={selectedColor} onChange={(e) => setSelectedColor(e.target.value)}
                  className="input-pill w-20 font-mono uppercase text-xs" />
              </div>
            </div>
          </div>

          <div className="h-px bg-hairline-soft" />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-ink">Choose Icon ({filteredIcons.length})</label>
              <div className="relative w-48">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search icons..."
                  className="input-pill pl-8" />
              </div>
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-8 gap-2 p-2.5 bg-surface-canvas border border-hairline rounded-lg max-h-56 overflow-y-auto custom-scrollbar">
              {filteredIcons.map((iconName) => {
                const isSelected = selectedIcon === iconName;
                return (
                  <button key={iconName} type="button" onClick={() => setSelectedIcon(iconName)} title={iconName}
                    className={`p-2.5 rounded-lg flex items-center justify-center transition-all cursor-pointer ${isSelected ? 'bg-surface-card ring-2 border-transparent scale-110 z-10' : 'hover:bg-surface-card text-muted border border-transparent hover:border-hairline'}`}
                    style={isSelected ? { color: selectedColor, borderColor: selectedColor, boxShadow: `0 2px 8px ${selectedColor}20` } : {}}>
                    {renderLucideIcon(iconName, 'w-5 h-5')}
                  </button>
                );
              })}
              {filteredIcons.length === 0 && <div className="col-span-full py-6 text-center text-xs text-muted">No icons matching "{searchQuery}"</div>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-hairline-soft bg-surface-card">
          <button onClick={onClose} className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-ink text-xs cursor-pointer border border-hairline">Cancel</button>
          <button onClick={handleConfirm} className="btn-pill text-xs cursor-pointer borderflex items-center gap-1.5">
            <Check className="w-4 h-4 text-white" /> Save
          </button>
        </div>
      </div>
    </div>
  );
};