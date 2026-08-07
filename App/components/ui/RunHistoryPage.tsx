import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RunSummary, WorkflowItem } from '../../types';
import { DEFAULT_WORKFLOW_ICON, DEFAULT_WORKFLOW_COLOR } from '../../types';
import { api } from '../../utils/api';
import { renderLucideIcon } from './IconPicker';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  History,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

interface RunHistoryPageProps {
  workflows: WorkflowItem[];
  initialWorkflowId?: string | null;
  onBack: () => void;
  backLabel?: string;
  onOpenRun: (runId: string) => void;
  /** When true, renders without the outer wrapper and header — for embedding in a tabbed layout. */
  embedded?: boolean;
}

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDuration = (ms: number): string =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;

const localDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addDays = (dateStr: string, delta: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateStr(new Date(y, m - 1, d + delta));
};

const toLocalIsoStart = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
};

const toLocalIsoEnd = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
};

const TODAY = localDateStr(new Date());

const statusChip = (status: string) => {
  if (status === 'success') {
    return <span className="status-badge status-badge-success"><CheckCircle2 className="w-3 h-3" />Success</span>;
  }
  if (status === 'error') {
    return <span className="status-badge status-badge-error"><AlertCircle className="w-3 h-3" />Failed</span>;
  }
  if (status === 'warning') {
    return <span className="status-badge status-badge-warning">⚠️ Warning</span>;
  }
  return <span className="status-badge status-badge-neutral">{status}</span>;
};

export const RunHistoryPage: React.FC<RunHistoryPageProps> = ({
  workflows,
  initialWorkflowId,
  onBack,
  backLabel,
  onOpenRun,
  embedded = false,
}) => {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(20);
  const [filterWorkflowId, setFilterWorkflowId] = useState(initialWorkflowId || 'all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string | null>(TODAY);
  const [toDate, setToDate] = useState<string | null>(TODAY);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(TODAY);
  const [draftTo, setDraftTo] = useState(TODAY);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const loadRuns = async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const wf = filterWorkflowId !== 'all' ? filterWorkflowId : undefined;
      const st = filterStatus !== 'all' ? filterStatus : undefined;
      const res = await api.listRuns(
        wf,
        targetPage * pageSize,
        pageSize,
        st,
        fromDate ? toLocalIsoStart(fromDate) : undefined,
        toDate ? toLocalIsoEnd(toDate) : undefined
      );
      setRuns(res.runs ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      setError((err as Error).message || 'Failed to load run history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setFilterWorkflowId(initialWorkflowId || 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorkflowId]);

  useEffect(() => {
    setPage(0);
    void loadRuns(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterWorkflowId, filterStatus, fromDate, toDate]);

  useEffect(() => {
    if (!datePickerOpen) return;
    const handler = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setDatePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [datePickerOpen]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const workflowOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    workflows.forEach((workflow) => byId.set(workflow.id, { id: workflow.id, name: workflow.name }));
    runs.forEach((run) => {
      if (!byId.has(run.workflowId)) byId.set(run.workflowId, { id: run.workflowId, name: run.workflowName });
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'en-US'));
  }, [runs, workflows]);

  /** Resolve the icon and color for a run from the live workflow list. */
  const resolveWorkflowAppearance = (run: RunSummary): { icon: string; color: string } => {
    const wf = workflows.find((w) => w.id === run.workflowId);
    return { icon: wf?.icon || DEFAULT_WORKFLOW_ICON, color: wf?.color || DEFAULT_WORKFLOW_COLOR };
  };

  const visibleRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return runs;
    return runs.filter((run) =>
      `${run.workflowName} ${run.id} ${run.status}`.toLowerCase().includes(normalizedQuery)
    );
  }, [query, runs]);

  const successCount = visibleRuns.filter((run) => run.status === 'success').length;
  const errorCount = visibleRuns.filter((run) => run.status === 'error').length;
  const totalDuration = visibleRuns.reduce((sum, run) => sum + (run.durationMs || 0), 0);

  const handleDelete = async (runId: string, event: React.SyntheticEvent) => {
    event.stopPropagation();
    try {
      await api.deleteRun(runId);
      setRuns((current) => current.filter((run) => run.id !== runId));
    } catch (err) {
      setError((err as Error).message || 'Failed to delete run record');
    }
  };

  const hasDateFilter = !!(fromDate || toDate);
  const singleDay = !!(fromDate && toDate && fromDate === toDate);
  const dateLabel = singleDay
    ? (fromDate ?? '')
    : fromDate && toDate
      ? `${fromDate} ~ ${toDate}`
      : 'All dates';

  const applyRange = (from: string | null, to: string | null) => {
    setFromDate(from);
    setToDate(to);
    setDatePickerOpen(false);
  };

  const togglePicker = () => {
    setDatePickerOpen((open) => {
      if (!open) {
        setDraftFrom(fromDate || '');
        setDraftTo(toDate || '');
      }
      return !open;
    });
  };

  const prevDay = () => {
    if (!fromDate) return;
    const next = addDays(fromDate, -1);
    setFromDate(next);
    setToDate(next);
  };

  const nextDay = () => {
    if (!fromDate) return;
    const next = addDays(fromDate, 1);
    setFromDate(next);
    setToDate(next);
  };

  const presets = [
    { label: '近一天', from: TODAY, to: TODAY },
    { label: '近3天', from: addDays(TODAY, -2), to: TODAY },
    { label: '近7天', from: addDays(TODAY, -6), to: TODAY },
    { label: '近30天', from: addDays(TODAY, -29), to: TODAY },
  ];

  const renderContent = () => (
    <div className="max-w-7xl mx-auto space-y-2">
      <section className="card-panel p-2 flex flex-col md:flex-row items-stretch md:items-center gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted shrink-0">
          <span>Total <strong className="text-ink font-semibold">{total}</strong></span>
          <span className="text-hairline-soft">|</span>
          <span>Success <strong className="text-timeline-grep font-semibold">{successCount}</strong></span>
          <span className="text-hairline-soft">|</span>
          <span>Failed <strong className="text-semantic-error font-semibold">{errorCount}</strong></span>
          <span className="hidden sm:inline text-hairline-soft">|</span>
          <span className="hidden sm:inline">Total Duration <strong className="text-ink font-semibold">{formatDuration(totalDuration)}</strong></span>
        </div>

        <div className="hidden md:block flex-1" />

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-1 shrink-0">
            {singleDay && (
              <button
                type="button"
                onClick={prevDay}
                title="Previous day"
                className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-canvas-soft border border-hairline"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}
            <div ref={datePickerRef} className="relative shrink-0">
              <button
                type="button"
                onClick={togglePicker}
                className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-ink border border-hairline flex items-center gap-1.5 px-3 py-1.5"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">{dateLabel}</span>
              </button>
              {datePickerOpen && (
                <div className="absolute right-0 top-full mt-2 z-40 card-panel p-3 w-72 shadow-lg">
                  <div className="grid grid-cols-2 gap-1.5">
                    {presets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setDraftFrom(preset.from);
                          setDraftTo(preset.to);
                          applyRange(preset.from, preset.to);
                        }}
                        className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-ink border border-hairline px-2 py-1.5 text-[11px]"
                      >
                        {preset.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => applyRange(null, null)}
                      className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-ink border border-hairline px-2 py-1.5 text-[11px]"
                    >
                      全部
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="date"
                      value={draftFrom}
                      onChange={(event) => setDraftFrom(event.target.value)}
                      className="input-pill text-xs flex-1 min-w-0"
                    />
                    <span className="text-muted">~</span>
                    <input
                      type="date"
                      value={draftTo}
                      onChange={(event) => setDraftTo(event.target.value)}
                      className="input-pill text-xs flex-1 min-w-0"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDraftFrom(fromDate || '');
                        setDraftTo(toDate || '');
                        setDatePickerOpen(false);
                      }}
                      className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-muted hover:text-ink border border-hairline px-3 py-1.5 flex-1"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const from = draftFrom.trim() || null;
                        const to = draftTo.trim() || null;
                        applyRange(from, to);
                      }}
                      className="btn-pill bg-ink text-white hover:opacity-90 px-3 py-1.5 flex-1"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
            {hasDateFilter && (
              <button
                type="button"
                onClick={() => applyRange(null, null)}
                title="Clear date range"
                className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-canvas-soft border border-hairline"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {singleDay && (
              <button
                type="button"
                onClick={nextDay}
                disabled={(fromDate ? addDays(fromDate, 1) : '') > TODAY}
                title="Next day"
                className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-canvas-soft border border-hairline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="relative flex-1 sm:w-44">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, ID..."
              className="input-pill pl-9 w-full text-xs"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={filterWorkflowId}
            onChange={(event) => setFilterWorkflowId(event.target.value)}
            className="input-pill w-full sm:w-36 text-xs"
            aria-label="Filter by workflow"
          >
            <option value="all">All Workflows</option>
            {workflowOptions.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
          </select>

          <select
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value)}
            className="input-pill w-full sm:w-24 text-xs"
            aria-label="Filter by status"
          >
            <option value="all">All Status</option>
            <option value="success">Success</option>
            <option value="error">Failed</option>
          </select>
        </div>
      </section>

      {error && (
        <div className="card-panel p-4 border-semantic-error/30 bg-semantic-error/5 flex items-center justify-between gap-3 text-xs text-semantic-error">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</span>
          <button onClick={() => void loadRuns()} className="btn-pill border border-semantic-error/30 text-semantic-error hover:bg-semantic-error/10">Retry</button>
        </div>
      )}

      <section className="card-panel overflow-hidden">
        {loading ? (
          <div className="p-10 flex flex-col items-center justify-center text-muted text-xs gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            Loading run records...
          </div>
        ) : visibleRuns.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center text-muted text-xs gap-3">
            <Clock className="w-8 h-8" />
            <span>{runs.length === 0 ? 'No run records yet. Run a workflow and records will appear here.' : 'No records match the current filters.'}</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-hairline-soft text-muted text-[10px] uppercase tracking-wider">
                  <th className="py-2 px-3 font-medium w-24">Status</th>
                  <th className="py-2 px-2.5 font-medium">Workflow</th>
                  <th className="py-2 px-2.5 font-medium hidden md:table-cell">Run ID</th>
                  <th className="py-2 px-2.5 font-medium hidden sm:table-cell">Started</th>
                  <th className="py-2 px-2.5 font-medium">Duration</th>
                  <th className="py-2 px-2.5 font-medium hidden lg:table-cell">Nodes</th>
                  <th className="py-2 px-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-soft">
                {visibleRuns.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => onOpenRun(run.id)}
                    className="group cursor-pointer hover:bg-surface-canvas/60 transition-colors"
                  >
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        {statusChip(run.status)}
                      </div>
                    </td>
                    <td className="py-2 px-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="p-1 rounded-md border shrink-0 flex items-center justify-center"
                          style={{
                            backgroundColor: `${resolveWorkflowAppearance(run).color}15`,
                            borderColor: `${resolveWorkflowAppearance(run).color}35`,
                            color: resolveWorkflowAppearance(run).color,
                          }}
                        >
                          {renderLucideIcon(resolveWorkflowAppearance(run).icon, 'w-3 h-3')}
                        </span>
                        <div className="text-sm font-medium text-ink truncate max-w-[280px] lg:max-w-[420px]">{run.workflowName}</div>
                      </div>
                    </td>
                    <td className="py-2 px-2.5 hidden md:table-cell">
                      <code className="text-[10px] font-mono text-muted">{run.id.slice(0, 12)}</code>
                    </td>
                    <td className="py-2 px-2.5 hidden sm:table-cell whitespace-nowrap text-muted">{formatTime(run.startedAt)}</td>
                    <td className="py-2 px-2.5 font-mono text-muted whitespace-nowrap">{formatDuration(run.durationMs)}</td>
                    <td className="py-2 px-2.5 hidden lg:table-cell">
                      <span className="font-mono text-muted text-[11px]">{run.nodeCount}</span>
                    </td>
                    <td className="py-2 px-2.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => void handleDelete(run.id, event)}
                          title="Delete record"
                          className="p-1.5 rounded-md text-muted hover:text-semantic-error hover:bg-semantic-error/5 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-muted px-1">
            <span>{total} records, page {page + 1}/{totalPages}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 0 || loading}
                onClick={() => {
                  const p = page - 1;
                  setPage(p);
                  void loadRuns(p);
                }}
                className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-muted hover:text-ink border border-hairline px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages - 1 || loading}
                onClick={() => {
                  const p = page + 1;
                  setPage(p);
                  void loadRuns(p);
                }}
                className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-muted hover:text-ink border border-hairline px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  if (embedded) {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar p-2 lg:p-3">
        {renderContent()}
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-surface-canvas text-body font-sans overflow-hidden">
      <header className="h-12 px-4 lg:px-6 bg-surface-canvas/90 border-b border-hairline flex items-center justify-between shrink-0 backdrop-blur-md z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-ink border border-hairline flex items-center gap-1.5 text-xs shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{backLabel || 'Back'}</span>
          </button>
          <div className="p-2 rounded-lg bg-black text-white shrink-0"><History className="w-4 h-4" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-medium text-sm text-ink tracking-tight">Run History</h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-surface-canvas-soft text-muted border border-hairline rounded-pill">Read-only</span>
            </div>
            <p className="text-[11px] text-muted truncate">View node status, output, and workflow snapshot for each execution</p>
          </div>
        </div>
        <button
          onClick={() => void loadRuns()}
          title="Refresh"
          className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-muted hover:text-ink border border-hairline shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto custom-scrollbar p-2 lg:p-3">
        {renderContent()}
      </main>
    </div>
  );
};
