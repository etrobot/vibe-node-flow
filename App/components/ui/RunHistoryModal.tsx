import React, { useState, useEffect } from 'react';
import { RunSummary, RunRecord, DEFAULT_WORKFLOW_ICON, DEFAULT_WORKFLOW_COLOR } from '../../types';
import { api } from '../../utils/api';
import { getModule } from '@/App/registry';
import { renderLucideIcon } from './IconPicker';
import { History, X, RefreshCw, CheckCircle2, AlertCircle, Clock, Trash2, FileJson, Loader2 } from 'lucide-react';

interface RunHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflowId: string | null;
  workflowName?: string;
  workflowIcon?: string;
  workflowColor?: string;
}

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatDuration = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);

const statusChip = (status: string) => {
  if (status === 'success') return <span className="status-badge status-badge-success"><CheckCircle2 className="w-3 h-3" /> Success</span>;
  if (status === 'error') return <span className="status-badge status-badge-error"><AlertCircle className="w-3 h-3" /> Failed</span>;
  if (status === 'warning') return <span className="status-badge status-badge-warning">⚠️ Warning</span>;
  return <span className="status-badge status-badge-neutral">{status}</span>;
};

export const RunHistoryModal: React.FC<RunHistoryModalProps> = ({ isOpen, onClose, workflowId, workflowName, workflowIcon, workflowColor }) => {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadRuns = async () => {
    if (!workflowId) return;
    setLoading(true);
    try {
      const list = await api.listRuns(workflowId);
      setRuns(list.runs ?? []);
      if ((list.runs ?? []).length > 0) { selectRun(list.runs[0].id); } else { setSelectedRunId(null); setDetail(null); }
    } catch (e) { console.error('Failed to load run history:', e); } finally { setLoading(false); }
  };

  const selectRun = async (id: string) => {
    setSelectedRunId(id);
    setLoadingDetail(true);
    try { setDetail(await api.getRun(id)); } catch (e) { console.error('Failed to load run detail:', e); setDetail(null); } finally { setLoadingDetail(false); }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteRun(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
      if (selectedRunId === id) { setSelectedRunId(null); setDetail(null); }
    } catch (err) { console.error('Failed to delete record:', err); }
  };

  useEffect(() => { if (isOpen && workflowId) loadRuns(); }, [isOpen, workflowId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl h-[82vh] card-panel flex flex-col overflow-hidden">
        <div className="h-14 px-5 border-b border-hairline-soft flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="p-1.5 rounded-lg shrink-0 flex items-center justify-center"
              style={{
                backgroundColor: `${workflowColor || DEFAULT_WORKFLOW_COLOR}15`,
                borderColor: `${workflowColor || DEFAULT_WORKFLOW_COLOR}35`,
                color: workflowColor || DEFAULT_WORKFLOW_COLOR,
                border: '1px solid',
              }}
            >
              {renderLucideIcon(workflowIcon || DEFAULT_WORKFLOW_ICON, 'w-4 h-4')}
            </div>
            <div>
              <h2 className="text-sm font-medium text-ink">Run History</h2>
              <p className="text-[11px] text-muted">{workflowName || 'Current Workflow'} · {runs.length} records</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={loadRuns} title="Refresh" className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-muted hover:text-ink border border-hairline">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="btn-pill bg-surface-canvas-soft hover:bg-surface-card text-muted hover:text-ink border border-hairline">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="w-80 border-r border-hairline-soft overflow-y-auto custom-scrollbar shrink-0 bg-surface-canvas/50">
            {runs.length === 0 && !loading && (
              <div className="p-6 text-center text-xs text-muted"><Clock className="w-6 h-6 mx-auto mb-2 text-muted" />No run records yet.</div>
            )}
            {runs.length > 0 && (
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-hairline-soft">
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    <th className="py-2.5 px-2 font-medium">Time</th>
                    <th className="py-2.5 px-2 font-medium hidden sm:table-cell">Duration</th>
                    <th className="py-2.5 px-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => selectRun(run.id)}
                      className={`cursor-pointer border-b border-hairline-soft transition-colors group ${selectedRunId === run.id ? 'bg-surface-card' : 'hover:bg-surface-card/70'}`}
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          {statusChip(run.status)}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap text-ink">{formatTime(run.startedAt)}</td>
                      <td className="py-2.5 px-2 font-mono text-muted whitespace-nowrap hidden sm:table-cell">{formatDuration(run.durationMs)}</td>
                      <td className="py-2.5 px-2">
                        <span
                          onClick={(e) => handleDelete(run.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted hover:text-semantic-error transition-all cursor-pointer inline-flex"
                          title="Delete record"
                        >
                          <Trash2 className="w-3 h-3" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 min-w-0">
            {loadingDetail ? (
              <div className="h-full flex items-center justify-center text-muted"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : !detail ? (
              <div className="h-full flex flex-col items-center justify-center text-muted text-xs"><FileJson className="w-8 h-8 mb-2 text-muted" />Select a record on the left to view details</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 pb-3 border-b border-hairline-soft">
                  <span
                    className="p-1.5 rounded-md border shrink-0 flex items-center justify-center"
                    style={{
                      backgroundColor: `${workflowColor || DEFAULT_WORKFLOW_COLOR}15`,
                      borderColor: `${workflowColor || DEFAULT_WORKFLOW_COLOR}35`,
                      color: workflowColor || DEFAULT_WORKFLOW_COLOR,
                    }}
                  >
                    {renderLucideIcon(workflowIcon || DEFAULT_WORKFLOW_ICON, 'w-3.5 h-3.5')}
                  </span>
                  {statusChip(detail.status)}
                  <span className="text-xs text-muted">{formatTime(detail.startedAt)} · Duration {formatDuration(detail.durationMs)}</span>
                </div>
                {detail.nodes.map((n, i) => (
                  <div key={`${n.nodeId}-${i}`} className="rounded-lg border border-hairline overflow-hidden">
                    <div className="px-3.5 py-2.5 bg-surface-canvas border-b border-hairline-soft flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-mono text-muted">#{i + 1}</span>
                        <span style={{ color: getModule(n.nodeType).color }}>
                          {renderLucideIcon(getModule(n.nodeType).icon, 'w-3.5 h-3.5 shrink-0')}
                        </span>
                        <span className="text-xs font-medium text-ink truncate">{n.nodeTitle}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted font-mono">{formatDuration(n.executionTime)}</span>
                        {statusChip(n.status)}
                      </div>
                    </div>
                    <div className="p-3 space-y-2">
                      {n.error && (
                        <div className={`p-2.5 rounded-lg text-[11px] font-mono break-all ${n.status === 'warning' ? 'bg-semantic-warning/10 border border-semantic-warning/25 text-[#94651f]' : 'bg-semantic-error/5 border border-semantic-error/20 text-semantic-error'}`}>
                          {n.status === 'warning' ? '⚠️ ' : ''}{n.error}
                        </div>
                      )}
                      {n.output !== null && n.output !== undefined && n.output !== '' && (
                        <div>
                          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Output</div>
                          <pre className="code-block max-h-56 whitespace-pre-wrap break-words">{typeof n.output === 'object' ? JSON.stringify(n.output, null, 2) : String(n.output)}</pre>
                        </div>
                      )}
                      {n.logs && n.logs.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Console Logs</div>
                          <div className="p-2.5 rounded-lg bg-black text-muted-soft text-[11px] font-mono space-y-0.5 max-h-40 overflow-y-auto custom-scrollbar">
                            {n.logs.map((log, li) => <div key={li} className="whitespace-pre-wrap break-words">{log}</div>)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
