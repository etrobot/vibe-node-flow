import React from 'react';
import * as LucideIcons from 'lucide-react';

export const ICON_LIST = [
  'Sparkles',
  'Bot',
  'Code',
  'Terminal',
  'Zap',
  'CheckCircle',
  'FileText',
  'Database',
  'ShieldCheck',
  'Cpu',
  'FileJson',
  'Wand2',
  'Binary',
  'Layers',
  'Search',
  'MessageSquare',
  'Braces',
  'Flame',
];

interface IconPickerProps {
  selectedIcon: string;
  onSelectIcon: (iconName: string) => void;
}

export const renderLucideIcon = (iconName: string, className = "w-5 h-5") => {
  const IconComponent = (LucideIcons as any)[iconName] || LucideIcons.HelpCircle;
  return <IconComponent className={className} />;
};

export const IconPicker: React.FC<IconPickerProps> = ({ selectedIcon, onSelectIcon }) => {
  return (
    <div className="grid grid-cols-6 gap-2 p-2 bg-black border border-hairline-strong rounded-lg">
      {ICON_LIST.map((iconName) => {
        const isSelected = selectedIcon === iconName;
        return (
          <button
            key={iconName}
            type="button"
            onClick={() => onSelectIcon(iconName)}
            title={iconName}
            className={`p-2 rounded-lg flex items-center justify-center transition-all ${
              isSelected
                ? 'bg-primary text-on-primary ring-2 ring-primary ring-offset-2 ring-offset-black scale-105'
                : 'text-muted-soft hover:text-ink hover:bg-surface-card'
            }`}
          >
            {renderLucideIcon(iconName, "w-5 h-5")}
          </button>
        );
      })}
    </div>
  );
};