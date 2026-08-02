import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FlowNode, FlowEdge, WorkflowItem } from './types';
import { api } from './utils/api';
import { nodeOutputToText, resolveUpstreamInput } from './utils/upstream';
import type { NodeTextInput } from '../lib/node-io';
import { Header } from './components/ui/Header';
import { HomePage } from './components/ui/HomePage';
import { RunDetailPage } from './components/ui/RunDetailPage';
import { FlowCanvas } from './FlowCanvas';
import { NodeInspector } from './NodeInspector';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  DEFAULT_NODE_TAG_CATALOG,
  isDefaultNodeTag,
  mergeNodeTagCatalog,
  normalizeNodeTag,
  uniqueNodeTags,
} from '../lib/workflow-tags';

export default function App() {
  // Navigation View State
  // 'home' = RunHistoryPage (default home), 'workflows' = WorkflowListHome,
  // 'canvas' = editor, 'run-detail' = execution detail
  const [currentView, setCurrentView] = useState<'home' | 'canvas' | 'workflows' | 'run-detail'>('home');
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [historyFilterWorkflowId, setHistoryFilterWorkflowId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // Track which tab to show when navigating to the home page
  const [homeInitialTab, setHomeInitialTab] = useState<'history' | 'workflows'>('history');

  // All Workflows (metadata + graph) loaded from the backend filesystem store
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);

  // Current Active Nodes & Edges in Canvas
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [tagCatalog, setTagCatalog] = useState<string[]>([...DEFAULT_NODE_TAG_CATALOG]);
  // Custom lane labels keyed by canvas column index (undefined entry → default "Lane N")
  const [laneLabels, setLaneLabels] = useState<string[]>([]);

  // Inspector & Layout state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState<boolean>(false);

  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [fullRunId, setFullRunId] = useState<string | null>(null);
  const [singleRunIds, setSingleRunIds] = useState<Record<string, string>>({});

  // Last-saved snapshot for dirty tracking & reset
  const [lastSavedNodes, setLastSavedNodes] = useState<FlowNode[]>([]);
  const [lastSavedEdges, setLastSavedEdges] = useState<FlowEdge[]>([]);
  const [lastSavedTagCatalog, setLastSavedTagCatalog] = useState<string[]>([...DEFAULT_NODE_TAG_CATALOG]);
  const [lastSavedLaneLabels, setLastSavedLaneLabels] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Dirty state: true when current canvas differs from last saved state
  const isDirty = useMemo(() => {
    if (!activeWorkflowId) return false;
    if (nodes.length !== lastSavedNodes.length || edges.length !== lastSavedEdges.length) return true;
    // Quick JSON comparison for structural changes
    const nodesChanged = JSON.stringify(nodes) !== JSON.stringify(lastSavedNodes);
    const edgesChanged = JSON.stringify(edges) !== JSON.stringify(lastSavedEdges);
    const tagCatalogChanged = JSON.stringify(tagCatalog) !== JSON.stringify(lastSavedTagCatalog);
    const laneLabelsChanged = JSON.stringify(laneLabels) !== JSON.stringify(lastSavedLaneLabels);
    return nodesChanged || edgesChanged || tagCatalogChanged || laneLabelsChanged;
  }, [activeWorkflowId, nodes, edges, tagCatalog, laneLabels, lastSavedNodes, lastSavedEdges, lastSavedTagCatalog, lastSavedLaneLabels]);

  // Explicit save: persist current nodes/edges to backend and update snapshot
  const handleSave = useCallback(async () => {
    if (!activeWorkflowId || isSaving) return;
    setIsSaving(true);
    try {
      const base = workflows.find((w) => w.id === activeWorkflowId);
      if (!base) return;
      const wf: WorkflowItem = { ...base, nodes, edges, tagCatalog, laneLabels, updatedAt: nowLabel() };
      await api.saveWorkflow(wf);
      setLastSavedNodes(nodes);
      setLastSavedEdges(edges);
      setLastSavedTagCatalog(tagCatalog);
      setLastSavedLaneLabels(laneLabels);
      setWorkflows((prev) =>
        prev.map((w) => (
          w.id === activeWorkflowId
            ? { ...w, nodes, edges, tagCatalog, laneLabels, updatedAt: nowLabel() }
            : w
        ))
      );
    } catch (e) {
      console.error('Save failed:', e);
      alert('Save failed: ' + (e as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [activeWorkflowId, isSaving, workflows, nodes, edges, tagCatalog, laneLabels]);

  // Reset: discard unsaved changes, restore to last saved state
  const handleReset = useCallback(() => {
    if (!activeWorkflowId || !isDirty) return;
    setNodes(lastSavedNodes);
    setEdges(lastSavedEdges);
    setTagCatalog(lastSavedTagCatalog);
    setLaneLabels(lastSavedLaneLabels);
    setWorkflows((prev) =>
      prev.map((workflow) => (
        workflow.id === activeWorkflowId
          ? {
              ...workflow,
              nodes: lastSavedNodes,
              edges: lastSavedEdges,
              tagCatalog: lastSavedTagCatalog,
              laneLabels: lastSavedLaneLabels,
            }
          : workflow
      ))
    );
    setSelectedNodeId(null);
  }, [activeWorkflowId, isDirty, lastSavedNodes, lastSavedEdges, lastSavedTagCatalog, lastSavedLaneLabels]);

  // Flush save before running workflow (safety measure)
  const flushSave = async () => {
    if (isDirty && activeWorkflowId) {
      await handleSave();
    }
  };

  // Load workflow list on first mount
  useEffect(() => {
    api.listWorkflows().then(setWorkflows).catch((e) => console.error('Failed to load workflow list:', e));
  }, []);

  const nowLabel = () =>
    `Today ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;

  // Sync current canvas nodes & edges back to active workflow state (no auto-save)
  const syncCanvasToWorkflow = (
    updatedNodes: FlowNode[],
    updatedEdges: FlowEdge[],
    updatedTagCatalog: string[] = tagCatalog,
  ) => {
    if (!activeWorkflowId) return;
    setWorkflows((prev) =>
      prev.map((w) =>
        w.id === activeWorkflowId
          ? {
              ...w,
              nodes: updatedNodes,
              edges: updatedEdges,
              tagCatalog: updatedTagCatalog,
              updatedAt: nowLabel(),
            }
          : w
      )
    );
  };

  // Switch to Canvas View — fetch the full workflow (with node bodies) from disk
  const handleOpenWorkflow = async (id: string) => {
    try {
      const full = await api.getWorkflow(id);
      const loadedTagCatalog = mergeNodeTagCatalog(
        full.tagCatalog,
        full.nodes.flatMap((node) => node.tags ?? []),
      );
      setActiveWorkflowId(id);
      setNodes(full.nodes);
      setEdges(full.edges);
      setTagCatalog(loadedTagCatalog);
      setLaneLabels(full.laneLabels ?? []);
      setLastSavedNodes(full.nodes);
      setLastSavedEdges(full.edges);
      setLastSavedTagCatalog(loadedTagCatalog);
      setLastSavedLaneLabels(full.laneLabels ?? []);
      setFullRunId(null);
      setSingleRunIds({});
      setSelectedNodeId(full.nodes.length > 0 ? full.nodes[0].id : null);
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === id
            ? {
                ...w,
                nodes: full.nodes,
                edges: full.edges,
                icon: full.icon || w.icon,
                color: full.color || w.color,
                tagCatalog: loadedTagCatalog,
                laneLabels: full.laneLabels ?? [],
              }
            : w
        )
      );
      setCurrentView('canvas');
    } catch (e) {
      console.error(e);
      alert('Failed to open workflow: ' + (e as Error).message);
    }
  };

  // Back to Workflows List
  const handleBackToHome = async () => {
    if (isDirty) {
      const shouldSave = window.confirm('You have unsaved changes. Save before leaving?');
      if (shouldSave) {
        await handleSave();
      }
    }
    try {
      const list = await api.listWorkflows();
      setWorkflows(list);
    } catch (e) {
      console.error(e);
    }
    setHomeInitialTab('workflows');
    setCurrentView('home');
    setActiveWorkflowId(null);
  };

  const handleDuplicateWorkflow = async (id: string) => {
    try {
      const wf = await api.duplicateWorkflow(id);
      setWorkflows((prev) => [wf, ...prev]);
    } catch (e) {
      alert('Failed to duplicate workflow: ' + (e as Error).message);
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    try {
      await api.deleteWorkflow(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      if (activeWorkflowId === id) {
        setActiveWorkflowId(null);
        setCurrentView('workflows');
      }
    } catch (e) {
      alert('Failed to delete workflow: ' + (e as Error).message);
    }
  };

  const handleOpenHistory = (workflowId: string | null) => {
    setHistoryFilterWorkflowId(workflowId);
    setHomeInitialTab('history');
    setSelectedRunId(null);
    setCurrentView('home');
  };

  const handleOpenRunDetail = (runId: string) => {
    setSelectedRunId(runId);
    setCurrentView('run-detail');
  };

  const handleEditWorkflowMeta = async (
    id: string,
    name: string,
    description: string,
    icon: string,
    color: string
  ) => {
    setWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, name, description, icon, color } : w))
    );
    try {
      await api.updateMeta(id, name, description, icon, color);
    } catch (e) {
      console.error('Failed to update workflow info:', e);
    }
  };

  // Rename Active Workflow from Header Title
  const handleRenameActiveWorkflow = (newName: string) => {
    if (!activeWorkflowId) return;
    setWorkflows((prev) =>
      prev.map((w) => (w.id === activeWorkflowId ? { ...w, name: newName } : w))
    );
  };

  // Update the active workflow's appearance (local state only — save explicitly to persist)
  const handleUpdateActiveWorkflowIcon = (icon: string, color: string) => {
    if (!activeWorkflowId) return;
    setWorkflows((prev) =>
      prev.map((w) => (w.id === activeWorkflowId ? { ...w, icon, color } : w))
    );
  };

  const handleUpdateNodePosition = (id: string, x: number, y: number) => {
    const newNodes = nodes.map((n) => (n.id === id ? { ...n, x, y } : n));
    setNodes(newNodes);
    syncCanvasToWorkflow(newNodes, edges);
  };

  const handleUpdateNode = (updatedNode: FlowNode) => {
    const newNodes = nodes.map((n) => (n.id === updatedNode.id ? updatedNode : n));
    setNodes(newNodes);
    syncCanvasToWorkflow(newNodes, edges);
  };

  const handleUpdateNodeTags = (nodeId: string, selectedTags: string[]) => {
    const nextSelectedTags = uniqueNodeTags(selectedTags);
    const nextTagCatalog = mergeNodeTagCatalog(tagCatalog, nextSelectedTags);
    const newNodes = nodes.map((node) => (
      node.id === nodeId ? { ...node, tags: nextSelectedTags } : node
    ));
    setNodes(newNodes);
    setTagCatalog(nextTagCatalog);
    syncCanvasToWorkflow(newNodes, edges, nextTagCatalog);
  };

  // Commit an edited lane label for the given canvas column index. Stores the
  // label at its column position; defaults ("Lane N") are not persisted.
  const handleUpdateLaneLabel = (colIndex: number, label: string) => {
    setLaneLabels((prev) => {
      const next = [...prev];
      // Trim trailing default entries so we don't persist "Lane N" placeholders
      while (next.length > colIndex && next[next.length - 1] === `Lane ${next.length}`) {
        next.pop();
      }
      // Pad up to colIndex if needed (entries between are treated as defaults)
      while (next.length < colIndex) {
        next.push(`Lane ${next.length + 1}`);
      }
      next[colIndex] = label;
      return next;
    });
  };

  const handleAddNodeTag = (nodeId: string, rawTag: string) => {
    const normalizedTag = normalizeNodeTag(rawTag);
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!normalizedTag || !node) return;

    const existingTag = tagCatalog.find(
      (tag) => tag.toLocaleLowerCase() === normalizedTag.toLocaleLowerCase(),
    );
    const tag = existingTag ?? normalizedTag;
    const nextTagCatalog = mergeNodeTagCatalog(tagCatalog, [tag]);
    const selectedTags = uniqueNodeTags([...(node.tags ?? []), tag]);
    const newNodes = nodes.map((candidate) => (
      candidate.id === nodeId ? { ...candidate, tags: selectedTags } : candidate
    ));

    setNodes(newNodes);
    setTagCatalog(nextTagCatalog);
    syncCanvasToWorkflow(newNodes, edges, nextTagCatalog);
  };

  const handleDeleteNodeTag = (tagToDelete: string) => {
    if (isDefaultNodeTag(tagToDelete)) return;
    const key = tagToDelete.toLocaleLowerCase();
    const nextTagCatalog = tagCatalog.filter((tag) => tag.toLocaleLowerCase() !== key);
    const newNodes = nodes.map((node) => ({
      ...node,
      tags: uniqueNodeTags(node.tags).filter((tag) => tag.toLocaleLowerCase() !== key),
    }));

    setNodes(newNodes);
    setTagCatalog(nextTagCatalog);
    syncCanvasToWorkflow(newNodes, edges, nextTagCatalog);
  };

  const handleDeleteNode = (id: string) => {
    const newNodes = nodes.filter((n) => n.id !== id);
    const newEdges = edges.filter((e) => e.fromNodeId !== id && e.toNodeId !== id);
    setNodes(newNodes);
    setEdges(newEdges);
    if (selectedNodeId === id) setSelectedNodeId(null);
    syncCanvasToWorkflow(newNodes, newEdges);
  };

  // Edge CRUD
  const handleConnect = (fromNodeId: string, toNodeId: string) => {
    if (fromNodeId === toNodeId) return;
    const exists = edges.some((e) => e.fromNodeId === fromNodeId && e.toNodeId === toNodeId);
    if (exists) return;

    const newEdge: FlowEdge = {
      id: `edge-${fromNodeId}-${toNodeId}`,
      fromNodeId,
      toNodeId,
      status: 'idle',
    };
    const newEdges = [...edges, newEdge];
    setEdges(newEdges);
    syncCanvasToWorkflow(nodes, newEdges);
  };

  const handleDeleteEdge = (id: string) => {
    const newEdges = edges.filter((e) => e.id !== id);
    setEdges(newEdges);
    syncCanvasToWorkflow(nodes, newEdges);
  };

  // Full Workflow Execution — runs server-side, streams live node status back
  const handleRunWorkflow = async () => {
    if (isRunning || nodes.length === 0 || !activeWorkflowId) return;
    setIsRunning(true);
    setFullRunId(null);
    setSingleRunIds({});

    // Reset statuses/outputs
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        status: 'idle',
        error: null,
        output: undefined,
        logs: undefined,
        executionTime: undefined,
      }))
    );
    setEdges((prev) => prev.map((e) => ({ ...e, status: 'idle' })));

    // Ensure the latest graph/config is on disk before the server reads it
    await flushSave();

    try {
      await api.runWorkflow(activeWorkflowId, (event) => {
        if (event.type === 'run-start') {
          setFullRunId(event.runId);
        } else if (event.type === 'node-start') {
          setNodes((prev) =>
            prev.map((n) => (n.id === event.nodeId ? { ...n, status: 'running' } : n))
          );
          setEdges((prev) =>
            prev.map((e) => (e.toNodeId === event.nodeId ? { ...e, status: 'running' } : e))
          );
        } else if (event.type === 'node-finish') {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === event.nodeId
                ? {
                    ...n,
                    status: event.status,
                    output: event.output,
                    logs: event.logs,
                    error: event.error ?? null,
                    executionTime: event.executionTime,
                  }
                : n
            )
          );
          setEdges((prev) =>
            prev.map((e) => (e.toNodeId === event.nodeId ? { ...e, status: event.status } : e))
          );
        }
      });
    } catch (e) {
      console.error('Run failed:', e);
      alert('Run failed: ' + (e as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleStopWorkflow = async () => {
    if (!isRunning || !fullRunId) return;
    try {
      await api.stopWorkflow(fullRunId);
    } catch (e) {
      console.error('Stop workflow failed:', e);
      alert('Stop workflow failed: ' + (e as Error).message);
    }
  };

  // Run Single Node Test — executes one node server-side
  const handleRunSingleNode = async (nodeId: string, manualInput?: string) => {
    const nodeToRun = nodes.find((n) => n.id === nodeId);
    if (!nodeToRun || !activeWorkflowId) return;

    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, status: 'running' } : n)));

    // Assemble known upstream outputs (keyed by id and title for {{...}} refs)
    const nodeOutputs: Record<string, string> = {};
    nodes.forEach((n) => {
      if (n.output !== undefined) {
        const edgeText = nodeOutputToText(n.output);
        nodeOutputs[n.title] = edgeText;
        nodeOutputs[n.id] = edgeText;
      }
    });
    const input: NodeTextInput = manualInput === undefined
      ? resolveUpstreamInput(nodeId, edges, nodes)
      : { __manual__: manualInput };

    await flushSave();

    try {
      const rec = await api.runSingleNode(activeWorkflowId, nodeId, {
        input,
        nodeOutputs,
      });
      setSingleRunIds((previous) => ({ ...previous, [nodeId]: rec.runId }));
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                status: rec.status,
                output: rec.output,
                logs: rec.logs,
                error: rec.error,
                executionTime: rec.executionTime,
              }
            : n
        )
      );
    } catch (e) {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, status: 'error', error: (e as Error).message } : n
        )
      );
    }
  };

  const activeWorkflow = workflows.find((w) => w.id === activeWorkflowId);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  if (currentView === 'home') {
    return (
      <>
        <HomePage
          workflows={workflows}
          initialFilterWorkflowId={historyFilterWorkflowId}
          initialTab={homeInitialTab}
          onOpenWorkflow={handleOpenWorkflow}
          onDuplicateWorkflow={handleDuplicateWorkflow}
          onDeleteWorkflow={handleDeleteWorkflow}
          onEditWorkflowMeta={handleEditWorkflowMeta}
          onOpenRun={handleOpenRunDetail}
        />
      </>
    );
  }

  if (currentView === 'run-detail' && selectedRunId) {
    return (
      <RunDetailPage
        runId={selectedRunId}
        onBack={() => setCurrentView('home')}
        onOpenWorkflow={(workflowId) => void handleOpenWorkflow(workflowId)}
      />
    );
  }

  // Render Canvas View
  return (
    <ErrorBoundary
      label="CanvasView"
      fallback={
        <div className="w-screen h-screen flex items-center justify-center bg-surface-canvas p-8">
          <div className="max-w-md p-6 rounded-xl bg-red-50 border border-red-200 text-center space-y-3">
            <div className="text-2xl">⚠️</div>
            <h2 className="text-lg font-semibold text-red-800">Canvas Render Error</h2>
            <p className="text-sm text-red-600">
              The canvas view encountered a render error. Please try refreshing the page. If the problem persists, check your node configuration.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm cursor-pointer"
            >
              Refresh Page
            </button>
          </div>
        </div>
      }
    >
      <div className="w-screen h-screen flex flex-col bg-surface-canvas font-sans text-body overflow-hidden antialiased">
        {/* Canvas Header */}
        <Header
          onRunWorkflow={handleRunWorkflow}
          onStopWorkflow={fullRunId ? () => void handleStopWorkflow() : undefined}
          isRunning={isRunning}
          onBackToHome={handleBackToHome}
          activeWorkflowName={activeWorkflow?.name}
          activeWorkflowIcon={activeWorkflow?.icon}
          activeWorkflowColor={activeWorkflow?.color}
          onRenameWorkflow={handleRenameActiveWorkflow}
          onUpdateWorkflowIcon={handleUpdateActiveWorkflowIcon}
          onOpenHistory={() => handleOpenHistory(activeWorkflowId)}
          onSave={handleSave}
          onReset={handleReset}
          isDirty={isDirty}
          isSaving={isSaving}
        />

        {/* Main Split Screen Area (Canvas + Node Inspector) */}
        <div className="flex-1 flex overflow-hidden relative">
          <div className="flex-1 h-full relative overflow-hidden">
            <FlowCanvas
              nodes={nodes}
              edges={edges}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => {
                setSelectedNodeId(id);
                if (id) {
                  setIsInspectorCollapsed(false);
                }
              }}
              onUpdateNodePosition={handleUpdateNodePosition}
              onConnect={handleConnect}
              onDeleteNode={handleDeleteNode}
              onDeleteEdge={handleDeleteEdge}
              onRunSingleNode={handleRunSingleNode}
              isRunning={isRunning}
              tagCatalog={tagCatalog}
              onUpdateNodeTags={handleUpdateNodeTags}
              onAddNodeTag={handleAddNodeTag}
              onDeleteNodeTag={handleDeleteNodeTag}
              laneLabels={laneLabels}
              onUpdateLaneLabel={handleUpdateLaneLabel}
            />
          </div>

          <NodeInspector
            node={selectedNode}
            allNodes={nodes}
            edges={edges}
            onUpdateNode={handleUpdateNode}
            onRunSingleNode={handleRunSingleNode}
            isCollapsed={isInspectorCollapsed}
            onToggleCollapse={() => setIsInspectorCollapsed(!isInspectorCollapsed)}
            workflowId={activeWorkflowId || undefined}
            runId={(selectedNodeId ? singleRunIds[selectedNodeId] : undefined) || fullRunId || undefined}
          />
        </div>

      </div>
    </ErrorBoundary>
  );
}
