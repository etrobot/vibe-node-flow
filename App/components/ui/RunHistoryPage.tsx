import React, { useEffect, useMemo, useState } from 'react';
import type { RunSummary, WorkflowItem } from '../../types';
import { DEFAULT_WORKFLOW_ICON, DEFAULT_WORKFLOW_COLOR } from '../../types';
import { api } from '../../utils/api';
import { renderLucideIcon } from './IconPicker';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  History,
  Loader2,
  Link2,
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
  onCopyRunLink?: (runId: string) => void;
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
  onCopyRunLink,
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

  const loadRuns = async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const wf = filterWorkflowId !== 'all' ? filterWorkflowId : undefined;
      const st = filterStatus !== 'all' ? filterStatus : undefined;
      const res = await api.listRuns(wf, targetPage * pageSize, pageSize, st);
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
  }, [filterWorkflowId, filterStatus]);

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

  const renderContent = () => (
    <div className="max-w-7xl mx-auto space-y-3 sm:space-y-4">
      <section className="card-panel p-3 flex flex-col md:flex-row items-stretch md:items-center gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-muted shrink-0">
          <span>Total <strong className="text-ink font-semibold">{total}</strong></span>
          <span className="text-hairline-soft">|</span>
          <span>Success <strong className="text-timeline-grep font-semibold">{successCount}</strong></span>
          <span className="text-hairline-soft">|</span>
          <span>Failed <strong className="text-semantic-error font-semibold">{errorCount}</strong></span>
          <span className="hidden sm:inline text-hairline-soft">|</span>
          <span className="hidden sm:inline">Total Duration <strong className="text-ink font-semibold">{formatDuration(totalDuration)}</strong></span>
        </div>

        <div className="hidden md:block flex-1" />

        <div className="grid grid-cols-1 xs:grid-cols-3 sm:flex items-center gap-2 w-full md:w-auto">
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
          <div className="p-16 flex flex-col items-center justify-center text-muted text-xs gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            Loading run records...
          </div>
        ) : visibleRuns.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-muted text-xs gap-3">
            <Clock className="w-8 h-8" />
            <span>{runs.length === 0 ? 'No run records yet. Run a workflow and records will appear here.' : 'No records match the current filters.'}</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-hairline-soft text-muted text-[10px] uppercase tracking-wider">
                  <th className="py-3 px-4 font-medium w-24">Status</th>
                  <th className="py-3 px-3 font-medium">Workflow</th>
                  <th className="py-3 px-3 font-medium hidden md:table-cell">Run ID</th>
                  <th className="py-3 px-3 font-medium hidden sm:table-cell">Started</th>
                  <th className="py-3 px-3 font-medium">Duration</th>
                  <th className="py-3 px-3 font-medium hidden lg:table-cell">Nodes</th>
                  <th className="py-3 px-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-soft">
                {visibleRuns.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => onOpenRun(run.id)}
                    className="group cursor-pointer hover:bg-surface-canvas/60 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {statusChip(run.status)}
                      </div>
                    </td>
                    <td className="py-3 px-3">
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
                    <td className="py-3 px-3 hidden md:table-cell">
                      <code className="text-[10px] font-mono text-muted">{run.id.slice(0, 12)}</code>
                    </td>
                    <td className="py-3 px-3 hidden sm:table-cell whitespace-nowrap text-muted">{formatTime(run.startedAt)}</td>
                    <td className="py-3 px-3 font-mono text-muted whitespace-nowrap">{formatDuration(run.durationMs)}</td>
                    <td className="py-3 px-3 hidden lg:table-cell">
                      <span className="font-mono text-muted text-[11px]">{run.nodeCount}</span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCopyRunLink?.(run.id);
                          }}
                          title="Copy link"
                          className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-surface-canvas-soft transition-colors"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
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
      <div className="h-full overflow-y-auto custom-scrollbar p-5 lg:p-8">
        {renderContent()}
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-surface-canvas text-body font-sans overflow-hidden">
      <header className="h-14 px-5 lg:px-7 bg-surface-canvas/90 border-b border-hairline flex items-center justify-between shrink-0 backdrop-blur-md z-30">
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

      <main className="flex-1 overflow-y-auto custom-scrollbar p-5 lg:p-8">
        {renderContent()}
      </main>
    </div>
  );
};
