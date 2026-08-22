import React, { useState } from 'react';
import {
  DEFAULT_WORKFLOW_COLOR,
  DEFAULT_WORKFLOW_ICON,
} from '../../types';
import { renderLucideIcon } from './IconPicker';
import { IconPickerModal } from './IconPickerModal';
import {
  Play,
  ArrowLeft,
  Edit3,
  Check,
  Loader2,
  History,
  Save,
  RotateCcw,
  CircleStop,
} from 'lucide-react';

import { ThemeSelector } from './ThemeSelector';
import { LayoutToggle } from './LayoutToggle';
import type { WorkspaceLayout } from '../../utils/workspace-layout';

interface HeaderProps {
  onRunWorkflow: () => void;
  onStopWorkflow?: () => void;
  isRunning: boolean;
  onBackToHome?: () => void;
  activeWorkflowName?: string;
  activeWorkflowIcon?: string;
  activeWorkflowColor?: string;
  onRenameWorkflow?: (newName: string) => void;
  onUpdateWorkflowIcon?: (icon: string, color: string) => void;
  onOpenHistory?: () => void;
  onSave?: () => void;
  onReset?: () => void;
  isDirty?: boolean;
  isSaving?: boolean;
  workspaceLayout?: WorkspaceLayout;
  onWorkspaceLayoutChange?: (layout: WorkspaceLayout) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onRunWorkflow,
  onStopWorkflow,
  isRunning,
  onBackToHome,
  activeWorkflowName,
  activeWorkflowIcon,
  activeWorkflowColor,
  onRenameWorkflow,
  onUpdateWorkflowIcon,
  onOpenHistory,
  onSave,
  onReset,
  isDirty = false,
  isSaving = false,
  workspaceLayout = 'canvas',
  onWorkspaceLayoutChange,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(activeWorkflowName || '');
  const [isWorkflowIconModalOpen, setIsWorkflowIconModalOpen] = useState(false);

  const workflowIcon = activeWorkflowIcon || DEFAULT_WORKFLOW_ICON;
  const workflowColor = activeWorkflowColor || DEFAULT_WORKFLOW_COLOR;

  const handleTitleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (titleInput.trim() && onRenameWorkflow) {
      onRenameWorkflow(titleInput.trim());
    }
    setIsEditingTitle(false);
  };

  return (
    <>
      <header className="relative z-50 h-14 px-3 sm:px-5 bg-surface-canvas/90 border-b border-hairline flex items-center justify-between shrink-0 backdrop-blur-md">
        {/* Left: Back button & Brand / Title */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          {onBackToHome && (
            <button
              onClick={onBackToHome}
              className="rounded-sm p-1 bg-surface-card hover:bg-surface-canvas-soft text-ink border border-hairline flex items-center gap-1 text-xs shrink-0"
              title="Back to workflow list"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsWorkflowIconModalOpen(true)}
            title="Click to configure workflow icon and color"
            className="p-1.5 sm:p-2 rounded-md border border-hairline flex items-center justify-center transition-all hover:scale-105 cursor-pointer shrink-0 bg-surface-card"
            style={{
              backgroundColor: '#ffffff',
              borderColor: `${workflowColor}40`,
              color: workflowColor,
            }}
          >
            {renderLucideIcon(workflowIcon, 'w-4 h-4 sm:w-5 sm:h-5')}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {isEditingTitle ? (
                <form onSubmit={handleTitleSubmit} className="flex items-center gap-1 min-w-0">
                  <input
                    type="text"
                    autoFocus
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onBlur={handleTitleSubmit}
                    className="input-pill text-xs font-medium max-w-[120px] sm:max-w-[200px]"
                  />
                  <button type="submit" className="text-primary-text p-0.5 shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </form>
              ) : (
                <div
                  onClick={() => {
                    setTitleInput(activeWorkflowName || 'Untitled Workflow');
                    setIsEditingTitle(true);
                  }}
                  className="group/title flex items-center gap-1 sm:gap-1.5 cursor-pointer min-w-0"
                >
                  <h1 className="font-medium text-xs sm:text-sm text-ink tracking-tight group-hover/title:text-primary-text transition-colors truncate max-w-[110px] sm:max-w-[240px]">
                    {activeWorkflowName || 'Genno'}
                  </h1>
                  <Edit3 className="w-3 h-3 text-muted opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
                </div>
              )}
              <span className="hidden md:inline-block px-2 py-0.5 text-[10px] font-semibold bg-surface-canvas-soft text-muted border border-hairline rounded-pill shrink-0">
                {workspaceLayout === 'app' ? 'App' : 'Canva'}
              </span>
              {isDirty && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-pill flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="hidden sm:inline">Unsaved</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted hidden sm:block">Drag to visually build and debug Agent-created workflows</p>
          </div>
        </div>

        {/* Right Tools: Save/Reset + Run Workflow */}
        <div className="flex items-center gap-1 sm:gap-2.5 shrink-0">
          {onWorkspaceLayoutChange && (
            <LayoutToggle layout={workspaceLayout} onChange={onWorkspaceLayoutChange} />
          )}
          <ThemeSelector />
          {/* Run History */}
          {onOpenHistory && (
            <button
              onClick={onOpenHistory}
              title="View run history"
              className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-ink border border-hairline flex items-center gap-1.5 text-xs px-2.5 sm:px-4"
            >
              <History className="w-3.5 h-3.5 text-muted" />
              <span className="hidden md:inline">History</span>
            </button>
          )}

          {/* Reset Button */}
          {onReset && (
            <button
              onClick={onReset}
              disabled={!isDirty}
              title="Reset unsaved changes"
              className={`btn-pill flex items-center gap-1.5 text-xs border px-2.5 sm:px-4 ${
                isDirty
                  ? 'bg-surface-card hover:bg-surface-canvas-soft text-ink border-hairline cursor-pointer active:scale-97'
                  : 'bg-surface-card text-muted border-hairline cursor-not-allowed opacity-50'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Reset</span>
            </button>
          )}

          {/* Save Button */}
          {onSave && (
            <button
              onClick={onSave}
              disabled={!isDirty || isSaving}
              title={isDirty ? 'Save changes' : 'No unsaved changes'}
              className={`btn-pill flex items-center gap-1.5 text-xs border px-2.5 sm:px-4 ${
                isDirty && !isSaving
                  ? 'bg-primary hover:bg-primary-active text-on-primary border-primary cursor-pointer active:scale-97'
                  : 'bg-surface-card text-muted border-hairline cursor-not-allowed opacity-50'
              }`}
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{isSaving ? 'Saving...' : 'Save'}</span>
              {isDirty && !isSaving && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              )}
            </button>
          )}

          {/* Run/Stop Flow Button — one active action at a time */}
          {isRunning ? (
            <button
              onClick={onStopWorkflow}
              disabled={!onStopWorkflow}
              title="Stop workflow"
              className="btn-pill flex items-center gap-1.5 text-xs px-2.5 sm:px-4 bg-semantic-error hover:bg-semantic-error/85 text-white border border-semantic-error cursor-pointer disabled:cursor-wait disabled:opacity-70"
            >
              <CircleStop className="w-4 h-4" />
              <span className="hidden sm:inline">Stop</span>
            </button>
          ) : (
            <button
              onClick={onRunWorkflow}
              title="Run workflow"
              className="btn-pill flex items-center gap-1.5 text-xs px-2.5 sm:px-4 bg-primary hover:bg-primary-active text-on-primary active:scale-97 border border-primary"
            >
              <Play className="w-4 h-4 fill-current" />
              <span className="hidden sm:inline">Run Workflow</span>
            </button>
          )}
        </div>
      </header>

      <IconPickerModal
        isOpen={isWorkflowIconModalOpen}
        onClose={() => setIsWorkflowIconModalOpen(false)}
        currentIcon={workflowIcon}
        currentColor={workflowColor}
        subjectLabel="Workflow"
        onSave={(icon, color) => onUpdateWorkflowIcon?.(icon, color)}
      />
    </>
  );
};
