import React, { useEffect, useMemo, useState } from 'react';
import type { FlowEdge, FlowNode, RunNodeRecord, RunRecord, RunWorkflowSnapshot, WorkflowItem } from '../../types';
import { DEFAULT_WORKFLOW_ICON, DEFAULT_WORKFLOW_COLOR } from '../../types';
import { api } from '../../utils/api';
import { getModule } from '@/App/registry';
import { FlowCanvas } from '@/App/FlowCanvas';
import { NodeInspector } from '@/App/NodeInspector';
import { renderLucideIcon } from './IconPicker';
import { ThemeSelector } from './ThemeSelector';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  Layers,
  Loader2,
  LockKeyhole,
  Zap,
} from 'lucide-react';

interface RunDetailPageProps {
  runId: string;
  onBack: () => void;
  onOpenWorkflow?: (workflowId: string) => void;
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

function syntheticSnapshot(record: RunRecord): RunWorkflowSnapshot {
  return {
    nodes: record.nodes.map((runNode, index) => {
      const nodeModule = getModule(runNode.nodeType);
      return {
        id: runNode.nodeId,
        type: runNode.nodeType,
        title: runNode.nodeTitle,
        icon: nodeModule.icon ?? 'Puzzle',
        lane: `Lane ${(index % 4) + 1}`,
        color: nodeModule.color,
        x: 100 + (index % 4) * 210,
        y: 160 + Math.floor(index / 4) * 160,
        config: nodeModule.createConfig?.() ?? {},
        status: 'idle',
      };
    }),
    edges: [],
  };
}

export const RunDetailPage: React.FC<RunDetailPageProps> = ({
  runId,
  onBack,
  onOpenWorkflow,
}) => {
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [currentWorkflow, setCurrentWorkflow] = useState<WorkflowItem | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const loadedRecord = await api.getRun(runId);
        let workflow: WorkflowItem | null = null;
        try {
          workflow = await api.getWorkflow(loadedRecord.workflowId);
        } catch {
          // Deleted workflows and old records are still viewable from their
          // persisted snapshot (or a generated node-only fallback).
        }
        if (cancelled) return;
        setRecord(loadedRecord);
        setCurrentWorkflow(workflow);
        setSelectedNodeId(loadedRecord.nodes[0]?.nodeId ?? loadedRecord.workflowSnapshot?.nodes[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Failed to load run detail');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [runId]);

  const snapshot = useMemo<RunWorkflowSnapshot | null>(() => {
    if (!record) return null;
    // Prefer the live workflow's current layout so the run viewer matches the
    // editor canvas. Fall back to the execution-time snapshot when the workflow
    // was deleted, then to a generated grid for legacy pre-snapshot records.
    if (currentWorkflow) return { nodes: currentWorkflow.nodes, edges: currentWorkflow.edges };
    if (record.workflowSnapshot?.nodes?.length) return record.workflowSnapshot;
    return syntheticSnapshot(record);
  }, [currentWorkflow, record]);

  const nodes = useMemo<FlowNode[]>(() => {
    if (!record || !snapshot) return [];
    const recordByNodeId = new Map<string, RunNodeRecord>(
      record.nodes.map((node): [string, RunNodeRecord] => [node.nodeId, node])
    );
    const snapshotNodeIds = new Set(snapshot.nodes.map((node) => node.id));

    const mapped = snapshot.nodes.map((node) => {
      const execution = recordByNodeId.get(node.id);
      return {
        ...node,
        status: execution?.status ?? 'idle',
        output: execution ? execution.output : undefined,
        logs: execution?.logs,
        resourceAccesses: execution?.resourceAccesses,
        error: execution?.error ?? null,
        executionTime: execution?.executionTime,
      } as FlowNode;
    });

    // A node can disappear from the current workflow before an old, pre-snapshot
    // run is opened. Keep that execution visible as a generated canvas node.
    record.nodes.forEach((execution, index) => {
      if (snapshotNodeIds.has(execution.nodeId)) return;
      const nodeModule = getModule(execution.nodeType);
      mapped.push({
        id: execution.nodeId,
        type: execution.nodeType,
        title: execution.nodeTitle,
        icon: nodeModule.icon ?? 'Puzzle',
        lane: `Lane ${((snapshot.nodes.length + index) % 4) + 1}`,
        color: nodeModule.color,
        x: 100 + ((snapshot.nodes.length + index) % 4) * 210,
        y: 160 + Math.floor((snapshot.nodes.length + index) / 4) * 160,
        config: nodeModule.createConfig?.() ?? {},
        status: execution.status,
        output: execution.output,
        logs: execution.logs,
        resourceAccesses: execution.resourceAccesses,
        error: execution.error,
        executionTime: execution.executionTime,
      });
    });

    return mapped;
  }, [record, snapshot]);

  const edges = useMemo<FlowEdge[]>(() => {
    if (!record || !snapshot) return [];
    const recordByNodeId = new Map<string, RunNodeRecord>(
      record.nodes.map((node): [string, RunNodeRecord] => [node.nodeId, node])
    );
    return snapshot.edges.map((edge) => {
      const target = recordByNodeId.get(edge.toNodeId);
      return {
        ...edge,
        status: target?.status === 'error'
          ? 'error'
          : target?.status === 'warning'
          ? 'warning'
          : target?.status === 'success'
          ? 'success'
          : 'idle',
      };
    });
  }, [record, snapshot]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedModule = selectedNode ? getModule(selectedNode.type) : null;

  /** Resolve the workflow icon and color from the live workflow (or default). */
  const workflowAppearance = useMemo(() => {
    if (currentWorkflow?.icon) return { icon: currentWorkflow.icon, color: currentWorkflow.color || DEFAULT_WORKFLOW_COLOR };
    return { icon: DEFAULT_WORKFLOW_ICON, color: DEFAULT_WORKFLOW_COLOR };
  }, [currentWorkflow]);

  if (loading) {
    return (
      <div className="w-screen h-screen bg-surface-canvas flex flex-col items-center justify-center text-muted text-xs gap-3">
        <Loader2 className="w-7 h-7 animate-spin" />
        Loading execution snapshot...
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="w-screen h-screen bg-surface-canvas flex flex-col items-center justify-center p-6 text-center">
        <div className="p-4 rounded-lg bg-semantic-error/5 border border-semantic-error/20 text-semantic-error mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-base font-medium text-ink">Failed to load execution details</h1>
        <p className="text-xs text-muted mt-2 mb-5">{error || 'Run record not found'}</p>
        <button onClick={onBack} className="btn-pill borderflex items-center gap-1.5 text-xs">
          <ArrowLeft className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-surface-canvas font-sans text-body overflow-hidden antialiased">
      <header className="h-14 px-5 bg-surface-canvas/90 border-b border-hairline flex items-center justify-between shrink-0 backdrop-blur-md z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="rounded-md p-1 bg-surface-card hover:bg-surface-canvas-soft text-ink border border-hairline flex items-center gap-1.5 text-xs shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div
            className="p-2 rounded-lg shrink-0 flex items-center justify-center"
            style={{
              backgroundColor: `${workflowAppearance.color}15`,
              borderColor: `${workflowAppearance.color}35`,
              color: workflowAppearance.color,
              border: '1px solid',
            }}
          >
            {renderLucideIcon(workflowAppearance.icon, 'w-4 h-4')}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="font-medium text-sm text-ink tracking-tight truncate">{record.workflowName}</h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-surface-canvas-soft text-muted border border-hairline rounded-pill inline-flex items-center gap-1 shrink-0">
                <LockKeyhole className="w-2.5 h-2.5" />Read-only Snapshot
              </span>
            </div>
            <p className="text-[10px] font-mono text-muted truncate mt-0.5">{record.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <ThemeSelector />
          <div className="hidden lg:flex items-center gap-3 text-[11px] text-muted mr-1">
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{formatTime(record.startedAt)}</span>
            <span className="font-mono">{formatDuration(record.durationMs)}</span>
          </div>
          {record.status === 'success' ? (
            <span className="status-badge status-badge-success"><CheckCircle2 className="w-3 h-3" />Success</span>
          ) : (
            <span className="status-badge status-badge-error"><AlertCircle className="w-3 h-3" />Failed</span>
          )}
          {currentWorkflow && onOpenWorkflow && (
            <button
              onClick={() => onOpenWorkflow(record.workflowId)}
              className="btn-pill bg-surface-card hover:bg-surface-canvas-soft text-ink border border-hairline flex items-center gap-1.5 text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open Workflow</span>
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 h-full relative overflow-hidden">
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              if (nodeId) setIsInspectorCollapsed(false);
            }}
            onUpdateNodePosition={() => undefined}
            onConnect={() => undefined}
            onDeleteNode={() => undefined}
            onDeleteEdge={() => undefined}
            onRunSingleNode={() => undefined}
            isRunning={false}
            readOnly
          />
        </div>

        <NodeInspector
          node={selectedNode}
          allNodes={nodes}
          edges={edges}
          onUpdateNode={() => undefined}
          onRunSingleNode={() => undefined}
          isCollapsed={isInspectorCollapsed}
          onToggleCollapse={() => setIsInspectorCollapsed((collapsed) => !collapsed)}
          readOnly
          workflowId={record.workflowId}
          runId={record.id}
          reuseOverwriteGeneratedAssets={Boolean(
            record.workflowSnapshot?.reuseOverwriteGeneratedAssets
            ?? currentWorkflow?.reuseOverwriteGeneratedAssets,
          )}
        />
      </div>

      {selectedNode && selectedModule?.RunOverlay && (
        <selectedModule.RunOverlay
          node={selectedNode}
          allNodes={nodes}
          edges={edges}
          onUpdateNode={() => undefined}
          onRunSingleNode={() => undefined}
          workflowId={record.workflowId}
          runId={record.id}
          readOnly
        />
      )}

    </div>
  );
};
