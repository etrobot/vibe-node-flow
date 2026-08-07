import React, { useRef, useState } from 'react';
import {
  WorkflowItem,
  DEFAULT_WORKFLOW_COLOR,
  DEFAULT_WORKFLOW_ICON,
} from '../../types';
import { api } from '../../utils/api';
import { renderLucideIcon } from './IconPicker';
import { IconPickerModal } from './IconPickerModal';
import {
  Search,
  Copy,
  Trash2,
  Edit3,
  Workflow,
  CheckCircle2,
  AlertCircle,
  Palette,
  X,
  History,
  CalendarClock,
  Loader2,
} from 'lucide-react';

interface WorkflowListHomeProps {
  workflows: WorkflowItem[];
  onOpenWorkflow: (id: string) => void;
  onDuplicateWorkflow: (id: string) => void;
  onDeleteWorkflow: (id: string) => void;
  onEditWorkflowMeta: (
    id: string,
    name: string,
    description: string,
    icon: string,
    color: string
  ) => void;
  onOpenHistory: (workflowId: string | null) => void;
  /** When true, renders without the outer wrapper and header — for embedding in a tabbed layout. */
  embedded?: boolean;
}

const formatTimestamp = (value?: string): string => {
  if (!value) return 'Just now';
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }
  return value;
};

const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const WorkflowListHome: React.FC<WorkflowListHomeProps> = ({
  workflows,
  onOpenWorkflow,
  onDuplicateWorkflow,
  onDeleteWorkflow,
  onEditWorkflowMeta,
  onOpenHistory,
  embedded = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Edit Meta Modal
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editIcon, setEditIcon] = useState(DEFAULT_WORKFLOW_ICON);
  const [editColor, setEditColor] = useState(DEFAULT_WORKFLOW_COLOR);
  const [isEditAppearanceOpen, setIsEditAppearanceOpen] = useState(false);

  // Server-owned cron schedule modal
  const [schedulingWorkflow, setSchedulingWorkflow] = useState<WorkflowItem | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleCron, setScheduleCron] = useState('0 9 * * *');
  const [scheduleTimezone, setScheduleTimezone] = useState(localTimezone());
  const [scheduleNextRunAt, setScheduleNextRunAt] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isScheduleLoading, setIsScheduleLoading] = useState(false);
  const [isScheduleSaving, setIsScheduleSaving] = useState(false);
  const scheduleRequestId = useRef(0);

  // Delete Confirm Modal
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  // Filtered Workflows
  const filteredWorkflows = workflows.filter(
    (w) =>
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleStartEditMeta = (w: WorkflowItem) => {
    setEditingMetaId(w.id);
    setEditName(w.name);
    setEditDesc(w.description);
    setEditIcon(w.icon || DEFAULT_WORKFLOW_ICON);
    setEditColor(w.color || DEFAULT_WORKFLOW_COLOR);
  };

  const handleCloseEditMeta = () => {
    setEditingMetaId(null);
    setIsEditAppearanceOpen(false);
  };

  const handleSaveEditMeta = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMetaId || !editName.trim()) return;
    onEditWorkflowMeta(
      editingMetaId,
      editName.trim(),
      editDesc.trim(),
      editIcon,
      editColor
    );
    setEditingMetaId(null);
    setIsEditAppearanceOpen(false);
    showToast('Workflow info updated');
  };

  const handleConfirmDelete = () => {
    if (deletingId) {
      onDeleteWorkflow(deletingId);
      setDeletingId(null);
      showToast('Workflow deleted');
    }
  };

  const handleDuplicate = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    onDuplicateWorkflow(id);
    showToast('Workflow duplicated');
  };

  const handleOpenSchedule = async (workflow: WorkflowItem) => {
    const requestId = ++scheduleRequestId.current;
    setSchedulingWorkflow(workflow);
    setScheduleEnabled(false);
    setScheduleCron('0 9 * * *');
    setScheduleTimezone(localTimezone());
    setScheduleError(null);
    setScheduleNextRunAt(null);
    setIsScheduleLoading(true);
    try {
      const schedule = await api.getWorkflowSchedule(workflow.id);
      if (requestId !== scheduleRequestId.current) return;
      setScheduleEnabled(schedule.enabled);
      setScheduleCron(schedule.cron);
      setScheduleTimezone(schedule.timezone);
      setScheduleNextRunAt(schedule.nextRunAt);
    } catch (error) {
      if (requestId !== scheduleRequestId.current) return;
      setScheduleError((error as Error).message);
    } finally {
      if (requestId === scheduleRequestId.current) setIsScheduleLoading(false);
    }
  };

  const handleCloseSchedule = () => {
    scheduleRequestId.current += 1;
    setSchedulingWorkflow(null);
    setScheduleError(null);
    setIsScheduleLoading(false);
  };

  const handleSaveSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!schedulingWorkflow) return;
    setScheduleError(null);
    setIsScheduleSaving(true);
    try {
      const schedule = await api.saveWorkflowSchedule(schedulingWorkflow.id, {
        enabled: scheduleEnabled,
        cron: scheduleCron,
        timezone: scheduleTimezone,
      });
      setScheduleNextRunAt(schedule.nextRunAt);
      setSchedulingWorkflow(null);
      showToast(schedule.enabled ? 'Server schedule enabled' : 'Schedule disabled');
    } catch (error) {
      setScheduleError((error as Error).message);
    } finally {
      setIsScheduleSaving(false);
    }
  };

  const renderContent = () => (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-4 sm:space-y-6">
      {/* Toolbar: search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 card-panel p-3 sm:p-3.5">
        {/* Search Box */}
        <div className="relative flex-1 max-w-full sm:max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workflow name or description..."
            className="input-pill pl-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Empty State */}
      {filteredWorkflows.length === 0 && (
        <div className="p-8 sm:p-12 text-center card-panel flex flex-col items-center justify-center space-y-3">
          <div className="p-4 bg-surface-canvas rounded-lg text-muted">
            <Search className="w-8 h-8" />
          </div>
          <h3 className="text-sm font-medium text-ink">
            {searchQuery ? 'No matching workflows found' : 'No workflows yet'}
          </h3>
          <p className="text-xs text-muted max-w-sm">
            {searchQuery
              ? 'Try different search keywords'
              : 'Workflows are created by Coding Agent. Once they appear here, you can open, run, and debug them.'}
          </p>
        </div>
      )}

      {/* MOBILE CARD VIEW (< 640px) */}
      {filteredWorkflows.length > 0 && (
        <div className="block sm:hidden space-y-3">
          {filteredWorkflows.map((workflow) => {
            const workflowIcon = workflow.icon || DEFAULT_WORKFLOW_ICON;
            const workflowColor = workflow.color || DEFAULT_WORKFLOW_COLOR;

            return (
              <div
                key={workflow.id}
                onClick={() => onOpenWorkflow(workflow.id)}
                className="card-panel p-4 space-y-3 hover:border-hairline-strong transition-all cursor-pointer active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className="p-2 rounded-lg border shrink-0 flex items-center justify-center"
                      style={{
                        backgroundColor: `${workflowColor}15`,
                        borderColor: `${workflowColor}35`,
                        color: workflowColor,
                      }}
                    >
                      {renderLucideIcon(workflowIcon, 'w-4 h-4')}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-ink truncate">
                        {workflow.name}
                      </div>
                      <div className="text-xs text-muted line-clamp-2 mt-0.5">
                        {workflow.description || (
                          <span className="text-muted-soft italic">No description</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenWorkflow(workflow.id);
                    }}
                    className="btn-pill bg-black hover:bg-black/80 text-white text-xs border border-black shrink-0 px-3 py-1"
                  >
                    Open
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs text-muted border-t border-hairline-soft pt-2.5">
                  <span className="px-2 py-0.5 bg-surface-canvas rounded-pill text-[10px] font-semibold">
                    {workflow.nodes.length} nodes
                  </span>
                  <span className="text-[11px]">{formatTimestamp(workflow.updatedAt)}</span>
                </div>

                <div
                  className="flex items-center justify-between gap-1 pt-1 border-t border-hairline-soft"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => void handleOpenSchedule(workflow)}
                    className="flex-1 py-1.5 rounded-md bg-surface-canvas text-muted hover:text-primary flex items-center justify-center gap-1 text-[11px] font-medium border border-hairline"
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    <span>Schedule</span>
                  </button>
                  <button
                    onClick={() => handleStartEditMeta(workflow)}
                    className="flex-1 py-1.5 rounded-md bg-surface-canvas text-muted hover:text-primary flex items-center justify-center gap-1 text-[11px] font-medium border border-hairline"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Rename</span>
                  </button>
                  <button
                    onClick={() => onOpenHistory(workflow.id)}
                    className="flex-1 py-1.5 rounded-md bg-surface-canvas text-muted hover:text-primary flex items-center justify-center gap-1 text-[11px] font-medium border border-hairline"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>History</span>
                  </button>
                  <button
                    onClick={(e) => handleDuplicate(workflow.id, e)}
                    className="p-1.5 rounded-md bg-surface-canvas text-muted hover:text-ink border border-hairline"
                    title="Duplicate"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeletingId(workflow.id)}
                    className="p-1.5 rounded-md bg-surface-canvas text-muted hover:text-semantic-error border border-hairline"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DESKTOP TABLE VIEW (>= 640px) */}
      {filteredWorkflows.length > 0 && (
        <div className="hidden sm:block card-panel overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-canvas border-b border-hairline text-muted font-semibold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4 w-24">Nodes</th>
                <th className="py-3 px-4 w-24">Updated</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-soft text-body">
              {filteredWorkflows.map((workflow) => {
                const workflowIcon = workflow.icon || DEFAULT_WORKFLOW_ICON;
                const workflowColor = workflow.color || DEFAULT_WORKFLOW_COLOR;

                return (
                  <tr
                    key={workflow.id}
                    onClick={() => onOpenWorkflow(workflow.id)}
                    className="hover:bg-surface-canvas/60 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-start gap-2.5">
                        <div
                          className="p-1.5 rounded-lg border shrink-0 mt-0.5 flex items-center justify-center"
                          style={{
                            backgroundColor: `${workflowColor}15`,
                            borderColor: `${workflowColor}35`,
                            color: workflowColor,
                          }}
                        >
                          {renderLucideIcon(workflowIcon, 'w-3.5 h-3.5')}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-ink group-hover:text-primary transition-colors">
                            {workflow.name}
                          </div>
                          <div className="text-[11px] text-muted leading-relaxed mt-0.5 line-clamp-2">
                            {workflow.description || (
                              <span className="text-muted-soft italic">No description</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 bg-surface-canvas rounded-pill text-[11px] font-semibold text-muted">
                        {workflow.nodes.length} nodes
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted text-[11px]">
                      {formatTimestamp(workflow.updatedAt)}
                    </td>
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onOpenWorkflow(workflow.id)}
                          className="btn-pill bg-black hover:bg-black/80 text-white text-[11px] border border-black whitespace-nowrap"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => void handleOpenSchedule(workflow)}
                          title="Schedule"
                          className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-muted hover:text-primary border border-hairline"
                        >
                          <CalendarClock className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleStartEditMeta(workflow)}
                          title="Rename"
                          className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-muted hover:text-primary border border-hairline"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onOpenHistory(workflow.id)}
                          title="Run History"
                          className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-muted hover:text-primary border border-hairline"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDuplicate(workflow.id, e)}
                          title="Duplicate"
                          className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-muted hover:text-ink border border-hairline"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingId(workflow.id)}
                          title="Delete"
                          className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-muted hover:text-semantic-error border border-hairline"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {renderContent()}
        {renderModals()}
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-surface-canvas text-body font-sans overflow-hidden select-none">
      {/* Toast Banner */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-black text-white text-xs font-medium px-4 py-2.5 rounded-pill flex items-center gap-2 border border-hairline-strong">
          <CheckCircle2 className="w-4 h-4 text-timeline-grep" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <header className="h-14 px-6 bg-surface-canvas/90 border-b border-hairline flex items-center justify-between shrink-0 backdrop-blur-md z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-black text-white flex items-center justify-center">
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-medium text-sm tracking-tight text-ink">
                AI Agent Workflow Manager
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-surface-canvas-soft text-muted border border-hairline rounded-pill">
                Multi-Workflow
              </span>
            </div>
            <p className="text-[11px] text-muted hidden sm:block">
              Drag to build, debug, and manage multiple AI hybrid automation workflows
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenHistory(null)}
            className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-ink border border-hairline flex items-center gap-2 text-xs cursor-pointer"
          >
            <History className="w-3.5 h-3.5 text-muted" />
            <span className="hidden sm:inline">Run History</span>
          </button>
        </div>
      </header>

      {renderContent()}

      {renderModals()}
    </div>
  );

  function renderModals() {
    return (<>
      {/* EDIT META MODAL */}
      {editingMetaId && (
        <div className="modal-overlay">
          <div className="w-full max-w-md card-panel overflow-hidden flex flex-col">
            <div className="panel-header">
              <h3 className="font-medium text-sm text-ink">Edit Workflow Info</h3>
              <button
                onClick={handleCloseEditMeta}
                className="text-muted hover:text-ink p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditMeta} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Workflow Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="input-pill"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Icon &amp; Color
                </label>
                <button
                  type="button"
                  onClick={() => setIsEditAppearanceOpen(true)}
                  className="w-full flex items-center gap-3 p-3 bg-surface-canvas hover:bg-surface-canvas-soft border border-hairline hover:border-hairline-strong rounded-lg text-left transition-all cursor-pointer"
                >
                  <span
                    className="w-10 h-10 rounded-lg border border-hairline flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: `${editColor}15`,
                      borderColor: `${editColor}35`,
                      color: editColor,
                    }}
                  >
                    {renderLucideIcon(editIcon, 'w-5 h-5')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-ink">
                      {editIcon}
                    </span>
                    <span className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted">
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-black/10"
                        style={{ backgroundColor: editColor }}
                      />
                      {editColor.toUpperCase()}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                    <Palette className="w-3.5 h-3.5" />
                    Choose
                  </span>
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="input-rounded"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCloseEditMeta}
                  className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-ink text-xs border border-hairline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-pill bg-black hover:bg-black/80 text-white text-xs cursor-pointer border border-black"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <IconPickerModal
        isOpen={isEditAppearanceOpen}
        onClose={() => setIsEditAppearanceOpen(false)}
        currentIcon={editIcon}
        currentColor={editColor}
        subjectLabel="Workflow"
        onSave={(icon, color) => {
          setEditIcon(icon);
          setEditColor(color);
        }}
      />

      {/* SERVER SCHEDULE MODAL */}
      {schedulingWorkflow && (
        <div className="modal-overlay">
          <div className="w-full max-w-md card-panel overflow-hidden flex flex-col">
            <div className="panel-header">
              <div className="flex items-center gap-2.5">
                <CalendarClock className="w-4 h-4 text-primary" />
                <div>
                  <h3 className="font-medium text-sm text-ink">Server Schedule</h3>
                  <p className="text-[11px] text-muted mt-0.5">{schedulingWorkflow.name}</p>
                </div>
              </div>
              <button
                onClick={handleCloseSchedule}
                className="text-muted hover:text-ink p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isScheduleLoading ? (
              <div className="p-8 flex items-center justify-center gap-2 text-xs text-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading server config...
              </div>
            ) : (
              <form onSubmit={handleSaveSchedule} className="p-6 space-y-4">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-hairline bg-surface-canvas cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(event) => setScheduleEnabled(event.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="block text-xs font-medium text-ink">Enable scheduled runs</span>
                    <span className="block text-[11px] text-muted mt-0.5 leading-relaxed">
                      Scheduled by node-cron on the server after saving. Closing the browser will not interrupt it.
                    </span>
                  </span>
                </label>

                <div>
                  <label className="block text-xs font-medium text-ink mb-1">Cron Expression</label>
                  <input
                    type="text"
                    required
                    value={scheduleCron}
                    onChange={(event) => setScheduleCron(event.target.value)}
                    placeholder="0 9 * * *"
                    className="input-pill font-mono"
                  />
                  <p className="text-[10px] text-muted mt-1.5">
                    E.g.: <code>0 9 * * *</code> daily at 09:00, <code>*/15 * * * *</code> every 15 minutes.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink mb-1">Timezone</label>
                  <input
                    type="text"
                    required
                    value={scheduleTimezone}
                    onChange={(event) => setScheduleTimezone(event.target.value)}
                    placeholder="Asia/Shanghai"
                    className="input-pill font-mono"
                  />
                </div>

                {scheduleNextRunAt && scheduleEnabled && (
                  <div className="text-[11px] text-muted bg-surface-canvas rounded-lg border border-hairline p-3">
                    Next run: {new Date(scheduleNextRunAt).toLocaleString('en-US')}
                  </div>
                )}

                {scheduleError && (
                  <div className="text-[11px] text-semantic-error bg-semantic-error/5 rounded-lg border border-semantic-error/20 p-3">
                    {scheduleError}
                  </div>
                )}

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCloseSchedule}
                    className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-ink text-xs border border-hairline"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isScheduleSaving}
                    className="btn-pill bg-black hover:bg-black/80 text-white text-xs cursor-pointer border border-black flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isScheduleSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save Schedule
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingId && (
        <div className="modal-overlay">
          <div className="w-full max-w-sm card-panel p-6 text-center space-y-4">
            <div className="p-3 bg-semantic-error/5 text-semantic-error rounded-lg w-12 h-12 mx-auto flex items-center justify-center border border-semantic-error/20">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-medium text-sm text-ink">Delete this workflow?</h3>
              <p className="text-xs text-muted mt-1">
                This action cannot be undone. Nodes and connections will be permanently lost.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setDeletingId(null)}
                className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-ink text-xs border border-hairline"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="btn-pill bg-semantic-error hover:bg-semantic-error/80 text-white text-xs cursor-pointer border border-semantic-error"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>);
  }
};
