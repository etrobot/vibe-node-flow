import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FlowNode,
  FlowEdge,
  WorkflowItem,
  RunEvent,
  RunNodeRecord,
  DEFAULT_WORKFLOW_COLOR,
  DEFAULT_WORKFLOW_ICON,
} from './types';
import { api } from './utils/api';
import { hasUpstreamData, nodeOutputToText, resolveUpstreamInput } from './utils/upstream';
import { ManualInputModal } from './components/ui/ManualInputModal';
import type { NodeTextInput } from '../lib/node-io';
import { Header } from './components/ui/Header';
import { HomePage } from './components/ui/HomePage';
import { RunDetailPage } from './components/ui/RunDetailPage';
import type { RunHistoryContext } from './components/ui/RunHistoryPage';
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
import { columnIndexOf, columnX, snapY, effectiveLaneLabel, findLaneLabelConflict } from '../lib/canvas-layout';
import { AppRoute, absoluteRouteUrl, parseRoute, routePath } from './utils/routes';

const initialRoute = parseRoute(window.location);

type AppView = 'home' | 'canvas' | 'run-detail';

/** Persistable node shape only — runtime status/output must not mark the canvas dirty. */
function persistableNode(node: FlowNode) {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    icon: node.icon,
    lane: node.lane,
    color: node.color,
    x: node.x,
    y: node.y,
    config: node.config,
    tags: node.tags,
  };
}

/** Persistable edge shape only — edge run status is ephemeral UI state. */
function persistableEdge(edge: FlowEdge) {
  return {
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
  };
}

type WorkflowMetaSnapshot = {
  name: string;
  description: string;
  icon: string;
  color: string;
};

function workflowMetaSnapshot(
  wf: Pick<WorkflowItem, 'name' | 'description' | 'icon' | 'color'>,
): WorkflowMetaSnapshot {
  return {
    name: wf.name,
    description: wf.description ?? '',
    icon: wf.icon ?? DEFAULT_WORKFLOW_ICON,
    color: wf.color ?? DEFAULT_WORKFLOW_COLOR,
  };
}

function resetRuntimeNode(node: FlowNode): FlowNode {
  return {
    ...node,
    status: 'idle',
    output: undefined,
    logs: undefined,
    resourceAccesses: undefined,
    executionTime: undefined,
    error: null,
  };
}

/** Rebuild the canvas runtime state from the server's event snapshot. */
function replayRunEvents(
  sourceNodes: FlowNode[],
  sourceEdges: FlowEdge[],
  events: RunEvent[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  let nextNodes = sourceNodes.map(resetRuntimeNode);
  let nextEdges: FlowEdge[] = sourceEdges.map((edge) => ({ ...edge, status: 'idle' }));

  events.forEach((event) => {
    if (event.type === 'node-start') {
      nextNodes = nextNodes.map((node) => (
        node.id === event.nodeId
          ? { ...node, status: 'running', logs: [], resourceAccesses: [], error: null }
          : node
      ));
      nextEdges = nextEdges.map((edge) => (
        edge.toNodeId === event.nodeId ? { ...edge, status: 'running' } : edge
      ));
    } else if (event.type === 'node-log') {
      nextNodes = nextNodes.map((node) => (
        node.id === event.nodeId
          ? { ...node, logs: [...(node.logs || []), event.line] }
          : node
      ));
    } else if (event.type === 'node-resource-access') {
      nextNodes = nextNodes.map((node) => (
        node.id === event.nodeId
          ? { ...node, resourceAccesses: [...(node.resourceAccesses || []), event.access] }
          : node
      ));
    } else if (event.type === 'node-finish' && event.nodeId !== '__engine__') {
      nextNodes = nextNodes.map((node) => (
        node.id === event.nodeId
          ? {
              ...node,
              status: event.status,
              output: event.output,
              logs: event.logs && event.logs.length > 0 ? event.logs : node.logs,
              resourceAccesses: event.resourceAccesses || node.resourceAccesses || [],
              error: event.error ?? null,
              executionTime: event.executionTime,
            }
          : node
      ));
      nextEdges = nextEdges.map((edge) => (
        edge.toNodeId === event.nodeId ? { ...edge, status: event.status } : edge
      ));
    }
  });

  return { nodes: nextNodes, edges: nextEdges };
}

function applyRunRecords(
  sourceNodes: FlowNode[],
  sourceEdges: FlowEdge[],
  records: RunNodeRecord[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  let nextNodes = sourceNodes.map(resetRuntimeNode);
  let nextEdges: FlowEdge[] = sourceEdges.map((edge) => ({ ...edge, status: 'idle' }));
  records.forEach((record) => {
    nextNodes = nextNodes.map((node) => (
      node.id === record.nodeId
        ? {
            ...node,
            status: record.status,
            output: record.output,
            logs: record.logs,
            resourceAccesses: record.resourceAccesses,
            error: record.error,
            executionTime: record.executionTime,
          }
        : node
    ));
    nextEdges = nextEdges.map((edge) => (
      edge.toNodeId === record.nodeId ? { ...edge, status: record.status } : edge
    ));
  });
  return { nodes: nextNodes, edges: nextEdges };
}

export default function App() {
  // Navigation View State
  // 'home' = RunHistoryPage (default home), 'workflows' = WorkflowListHome,
  // 'canvas' = editor, 'run-detail' = execution detail
  const [currentView, setCurrentView] = useState<AppView>(initialRoute.view);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(
    initialRoute.view === 'canvas' ? initialRoute.workflowId : null,
  );
  const [historyFilterWorkflowId, setHistoryFilterWorkflowId] = useState<string | null>(
    initialRoute.view === 'home' ? initialRoute.workflowId : null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    initialRoute.view === 'run-detail' ? initialRoute.runId : null,
  );
  // Track which tab to show when navigating to the home page
  const [homeInitialTab, setHomeInitialTab] = useState<'history' | 'workflows'>(
    initialRoute.view === 'home' ? initialRoute.tab : 'history',
  );
  const [historyReturnContext, setHistoryReturnContext] = useState<RunHistoryContext | null>(null);

  // All Workflows (metadata + graph) loaded from the backend filesystem store
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);

  // Current Active Nodes & Edges in Canvas
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [tagCatalog, setTagCatalog] = useState<string[]>([...DEFAULT_NODE_TAG_CATALOG]);
  // Custom lane labels keyed by canvas column index (undefined entry → default "Lane N")
  const [laneLabels, setLaneLabels] = useState<string[]>([]);
  const [reuseOverwriteGeneratedAssets, setReuseOverwriteGeneratedAssets] = useState(false);

  // Inspector & Layout state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState<boolean>(false);

  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [fullRunId, setFullRunId] = useState<string | null>(null);
  const [singleRunIds, setSingleRunIds] = useState<Record<string, string>>({});
  const [manualInputPromptNodeId, setManualInputPromptNodeId] = useState<string | null>(null);
  const [lastManualInputs, setLastManualInputs] = useState<Record<string, string>>({});

  // Last-saved snapshot for dirty tracking & reset
  const [lastSavedNodes, setLastSavedNodes] = useState<FlowNode[]>([]);
  const [lastSavedEdges, setLastSavedEdges] = useState<FlowEdge[]>([]);
  const [lastSavedTagCatalog, setLastSavedTagCatalog] = useState<string[]>([...DEFAULT_NODE_TAG_CATALOG]);
  const [lastSavedLaneLabels, setLastSavedLaneLabels] = useState<string[]>([]);
  const [lastSavedReuseOverwriteGeneratedAssets, setLastSavedReuseOverwriteGeneratedAssets] = useState(false);
  const [lastSavedMeta, setLastSavedMeta] = useState<WorkflowMetaSnapshot>({
    name: '',
    description: '',
    icon: DEFAULT_WORKFLOW_ICON,
    color: DEFAULT_WORKFLOW_COLOR,
  });
  const [isSaving, setIsSaving] = useState(false);
  const nodesRef = useRef<FlowNode[]>([]);
  const edgesRef = useRef<FlowEdge[]>([]);
  const hydratedRunIdRef = useRef<string | null>(null);
  // Keep the exact history context that opened a run detail page. The detail
  // route itself is intentionally stable (/runs/:id), so this belongs in the
  // app navigation state rather than in the run record.
  const runDetailReturnRouteRef = useRef<AppRoute | null>(null);
  const runDetailReturnContextRef = useRef<RunHistoryContext | null>(null);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const applyRoute = useCallback((route: AppRoute) => {
    if (route.view === 'canvas') {
      setActiveWorkflowId(route.workflowId);
      setCurrentView('canvas');
      return;
    }
    if (route.view === 'run-detail') {
      setSelectedRunId(route.runId);
      setCurrentView('run-detail');
      return;
    }
    setHistoryFilterWorkflowId(route.workflowId);
    setHomeInitialTab(route.tab);
    setSelectedRunId(null);
    setActiveWorkflowId(null);
    setCurrentView('home');
  }, []);

  const navigateTo = useCallback((route: AppRoute, replace = false) => {
    const nextPath = routePath(route);
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (currentPath !== nextPath) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', nextPath);
    }
    applyRoute(route);
  }, [applyRoute]);

  // Dirty state: true when persistable graph/config differs from last saved snapshot.
  // Running a workflow mutates status/output/logs — those must not count as unsaved edits.
  const isDirty = useMemo(() => {
    if (!activeWorkflowId) return false;
    if (nodes.length !== lastSavedNodes.length || edges.length !== lastSavedEdges.length) return true;
    const nodesChanged =
      JSON.stringify(nodes.map(persistableNode)) !== JSON.stringify(lastSavedNodes.map(persistableNode));
    const edgesChanged =
      JSON.stringify(edges.map(persistableEdge)) !== JSON.stringify(lastSavedEdges.map(persistableEdge));
    const tagCatalogChanged = JSON.stringify(tagCatalog) !== JSON.stringify(lastSavedTagCatalog);
    const laneLabelsChanged = JSON.stringify(laneLabels) !== JSON.stringify(lastSavedLaneLabels);
    const reuseOverwriteChanged = reuseOverwriteGeneratedAssets !== lastSavedReuseOverwriteGeneratedAssets;
    const activeWorkflowMeta = workflows.find((workflow) => workflow.id === activeWorkflowId);
    const metaChanged = activeWorkflowMeta
      ? JSON.stringify(workflowMetaSnapshot(activeWorkflowMeta)) !== JSON.stringify(lastSavedMeta)
      : false;
    return nodesChanged || edgesChanged || tagCatalogChanged || laneLabelsChanged || reuseOverwriteChanged || metaChanged;
  }, [activeWorkflowId, workflows, nodes, edges, tagCatalog, laneLabels, reuseOverwriteGeneratedAssets, lastSavedNodes, lastSavedEdges, lastSavedTagCatalog, lastSavedLaneLabels, lastSavedReuseOverwriteGeneratedAssets, lastSavedMeta]);

  // Explicit save: persist current nodes/edges to backend and update snapshot
  const handleSave = useCallback(async () => {
    if (!activeWorkflowId || isSaving) return;
    setIsSaving(true);
    try {
      let base = workflows.find((w) => w.id === activeWorkflowId);
      if (!base) {
        console.warn(`[App] handleSave: workflow ${activeWorkflowId} missing from list, fetching from server`);
        base = await api.getWorkflow(activeWorkflowId);
        setWorkflows((prev) => (
          prev.some((workflow) => workflow.id === base!.id)
            ? prev.map((workflow) => (workflow.id === base!.id ? { ...workflow, ...base! } : workflow))
            : [...prev, base!]
        ));
      }
      const wf: WorkflowItem = {
        ...base,
        nodes,
        edges,
        tagCatalog,
        laneLabels,
        reuseOverwriteGeneratedAssets,
        updatedAt: nowLabel(),
      };
      console.log(`[App] handleSave: saving workflow ${activeWorkflowId}`);
      const saved = await api.saveWorkflow(wf);
      setLastSavedNodes(nodes);
      setLastSavedEdges(edges);
      setLastSavedTagCatalog(tagCatalog);
      setLastSavedLaneLabels(laneLabels);
      setLastSavedReuseOverwriteGeneratedAssets(reuseOverwriteGeneratedAssets);
      setLastSavedMeta(workflowMetaSnapshot(saved));
      setWorkflows((prev) =>
        prev.map((w) => (
          w.id === activeWorkflowId
            ? {
                ...w,
                ...saved,
                nodes,
                edges,
                tagCatalog,
                laneLabels,
                reuseOverwriteGeneratedAssets,
                updatedAt: saved.updatedAt,
              }
            : w
        ))
      );
    } catch (e) {
      console.error('Save failed:', e);
      alert('Save failed: ' + (e as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [activeWorkflowId, isSaving, workflows, nodes, edges, tagCatalog, laneLabels, reuseOverwriteGeneratedAssets]);

  // Reset: discard unsaved changes, restore to last saved state
  const handleReset = useCallback(() => {
    if (!activeWorkflowId || !isDirty) return;
    setNodes(lastSavedNodes);
    setEdges(lastSavedEdges);
    setTagCatalog(lastSavedTagCatalog);
    setLaneLabels(lastSavedLaneLabels);
    setReuseOverwriteGeneratedAssets(lastSavedReuseOverwriteGeneratedAssets);
    setWorkflows((prev) =>
      prev.map((workflow) => (
        workflow.id === activeWorkflowId
          ? {
              ...workflow,
              ...lastSavedMeta,
              nodes: lastSavedNodes,
              edges: lastSavedEdges,
              tagCatalog: lastSavedTagCatalog,
              laneLabels: lastSavedLaneLabels,
              reuseOverwriteGeneratedAssets: lastSavedReuseOverwriteGeneratedAssets,
            }
          : workflow
      ))
    );
    setSelectedNodeId(null);
  }, [activeWorkflowId, isDirty, lastSavedNodes, lastSavedEdges, lastSavedTagCatalog, lastSavedLaneLabels, lastSavedReuseOverwriteGeneratedAssets, lastSavedMeta]);

  // Flush save before running workflow (safety measure)
  const flushSave = async () => {
    if (isDirty && activeWorkflowId) {
      await handleSave();
    }
  };

  const applyRunEvent = useCallback((event: RunEvent) => {
    if (event.type === 'node-start') {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === event.nodeId
            ? { ...node, status: 'running', logs: [], resourceAccesses: [], error: null }
            : node
        )
      );
      setEdges((prev) =>
        prev.map((edge) => (edge.toNodeId === event.nodeId ? { ...edge, status: 'running' } : edge))
      );
    } else if (event.type === 'node-log') {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === event.nodeId
            ? { ...node, logs: [...(node.logs || []), event.line] }
            : node
        )
      );
    } else if (event.type === 'node-resource-access') {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === event.nodeId
            ? { ...node, resourceAccesses: [...(node.resourceAccesses || []), event.access] }
            : node
        )
      );
    } else if (event.type === 'node-finish' && event.nodeId !== '__engine__') {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === event.nodeId
            ? {
                ...node,
                status: event.status,
                output: event.output,
                logs: event.logs && event.logs.length > 0 ? event.logs : node.logs,
                resourceAccesses: event.resourceAccesses || node.resourceAccesses || [],
                error: event.error ?? null,
                executionTime: event.executionTime,
              }
            : node
        )
      );
      setEdges((prev) =>
        prev.map((edge) => (edge.toNodeId === event.nodeId ? { ...edge, status: event.status } : edge))
      );
    }
  }, []);

  // Load workflow list on first mount
  useEffect(() => {
    api.listWorkflows().then(setWorkflows).catch((e) => console.error('Failed to load workflow list:', e));

    const onPopState = () => {
      const route = parseRoute(window.location);
      applyRoute(route);
      if (route.view === 'canvas') void handleOpenWorkflow(route.workflowId, false);
    };
    window.addEventListener('popstate', onPopState);
    if (initialRoute.view === 'canvas') {
      void handleOpenWorkflow(initialRoute.workflowId, false);
    }
    return () => window.removeEventListener('popstate', onPopState);
    // The initial URL is intentionally read once. Navigation after mount uses
    // navigateTo and popstate above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const handleOpenWorkflow = async (id: string, updateUrl = true) => {
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
      setReuseOverwriteGeneratedAssets(Boolean(full.reuseOverwriteGeneratedAssets));
      setLastSavedNodes(full.nodes);
      setLastSavedEdges(full.edges);
      setLastSavedTagCatalog(loadedTagCatalog);
      setLastSavedLaneLabels(full.laneLabels ?? []);
      setLastSavedReuseOverwriteGeneratedAssets(Boolean(full.reuseOverwriteGeneratedAssets));
      setLastSavedMeta(workflowMetaSnapshot(full));
      setFullRunId(null);
      setSingleRunIds({});
      setIsRunning(false);
      hydratedRunIdRef.current = null;
      setSelectedNodeId(full.nodes.length > 0 ? full.nodes[0].id : null);
      setWorkflows((prev) => {
        const hydrated: WorkflowItem = {
          ...full,
          tagCatalog: loadedTagCatalog,
          laneLabels: full.laneLabels ?? [],
          reuseOverwriteGeneratedAssets: Boolean(full.reuseOverwriteGeneratedAssets),
        };
        const existing = prev.find((workflow) => workflow.id === id);
        if (!existing) return [...prev, hydrated];
        return prev.map((workflow) => (workflow.id === id ? { ...existing, ...hydrated } : workflow));
      });
      setCurrentView('canvas');
      if (updateUrl) navigateTo({ view: 'canvas', workflowId: id });
    } catch (e) {
      console.error(e);
      alert('Failed to open workflow: ' + (e as Error).message);
    }
  };

  // A canvas can be reopened after its original streaming request disappeared.
  // Poll the server-side job snapshot so the canvas catches up with new node
  // starts, logs, and finishes without starting a second workflow.
  useEffect(() => {
    if (currentView !== 'canvas' || !activeWorkflowId) return;
    let cancelled = false;

    const refreshActiveRun = async () => {
      try {
        const active = await api.getActiveWorkflowRun(activeWorkflowId);
        if (cancelled) return;

        if (active) {
          hydratedRunIdRef.current = active.id;
          const runtime = replayRunEvents(nodesRef.current, edgesRef.current, active.events);
          setNodes(runtime.nodes);
          setEdges(runtime.edges);
          if (active.trigger === 'single') {
            const nodeStart = active.events.find((event) => event.type === 'node-start');
            if (nodeStart?.type === 'node-start') {
              setSingleRunIds({ [nodeStart.nodeId]: active.id });
            }
          } else {
            setFullRunId(active.id);
            setIsRunning(true);
          }
          return;
        }

        // If the job finished between polls, replace the last running view
        // with the persisted final node records.
        const previousRunId = hydratedRunIdRef.current;
        if (previousRunId) {
          const completed = await api.getRun(previousRunId);
          if (cancelled) return;
          const runtime = applyRunRecords(nodesRef.current, edgesRef.current, completed.nodes);
          setNodes(runtime.nodes);
          setEdges(runtime.edges);
          setIsRunning(false);
          setFullRunId(null);
          setSingleRunIds({});
          hydratedRunIdRef.current = null;
        }
      } catch (error) {
        if (!cancelled) console.error('Failed to restore active workflow run:', error);
      }
    };

    void refreshActiveRun();
    const timer = window.setInterval(() => void refreshActiveRun(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWorkflowId, currentView]);

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
    navigateTo({ view: 'home', tab: 'workflows', workflowId: null });
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
        setHomeInitialTab('workflows');
        setCurrentView('home');
        navigateTo({ view: 'home', tab: 'workflows', workflowId: null });
      }
    } catch (e) {
      alert('Failed to delete workflow: ' + (e as Error).message);
    }
  };

  const handleOpenHistory = (workflowId: string | null) => {
    setHistoryReturnContext(null);
    setHistoryFilterWorkflowId(workflowId);
    setHomeInitialTab('history');
    setSelectedRunId(null);
    setCurrentView('home');
    navigateTo({ view: 'home', tab: 'history', workflowId });
  };

  const handleOpenRunDetail = (runId: string, context?: RunHistoryContext) => {
    const currentRoute = parseRoute(window.location);
    runDetailReturnContextRef.current = context ?? null;
    runDetailReturnRouteRef.current = currentRoute.view === 'home'
      ? {
          ...currentRoute,
          workflowId: context?.workflowId === undefined ? currentRoute.workflowId : context.workflowId,
        }
      : { view: 'home', tab: 'history', workflowId: context?.workflowId ?? null };
    setSelectedRunId(runId);
    setCurrentView('run-detail');
    navigateTo({ view: 'run-detail', runId });
  };

  const handleBackFromRunDetail = () => {
    const returnRoute = runDetailReturnRouteRef.current
      ?? { view: 'home', tab: 'history', workflowId: null } satisfies AppRoute;
    setHistoryReturnContext(runDetailReturnContextRef.current);
    runDetailReturnRouteRef.current = null;
    runDetailReturnContextRef.current = null;
    // Replace the detail entry so browser Back does not reopen the same run.
    navigateTo(returnRoute, true);
  };

  const handleHomeTabChange = (
    tab: 'history' | 'workflows',
    workflowId = historyFilterWorkflowId,
  ) => {
    if (tab === 'history') {
      handleOpenHistory(workflowId);
    } else {
      setHomeInitialTab('workflows');
      setHistoryFilterWorkflowId(null);
      setHistoryReturnContext(null);
      setCurrentView('home');
      navigateTo({ view: 'home', tab: 'workflows', workflowId: null });
    }
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
    const column = columnIndexOf(x);
    const lane = laneLabels[column]?.trim() || `Lane ${column + 1}`;
    const newNodes = nodes.map((n) => (
      n.id === id ? { ...n, x: columnX(column), y: snapY(y), lane } : n
    ));
    setNodes(newNodes);
    syncCanvasToWorkflow(newNodes, edges);
  };

  const handleUpdateNode = (updatedNode: FlowNode) => {
    const current = nodes.find((n) => n.id === updatedNode.id);
    const column = columnIndexOf(updatedNode.x ?? current?.x ?? 0);
    const lane = updatedNode.lane?.trim() || current?.lane || laneLabels[column] || `Lane ${column + 1}`;
    const normalizedNode = {
      ...updatedNode,
      x: columnX(column),
      y: snapY(updatedNode.y ?? current?.y ?? 0),
      lane,
    };
    const newNodes = nodes.map((n) => (n.id === updatedNode.id ? normalizedNode : n));
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

  // Commit an edited lane label for the given canvas column index and keep
  // every node in that column's required lane property in sync.
  const handleUpdateLaneLabel = useCallback((colIndex: number, label: string): boolean => {
    const nextLabel = label.trim() || `Lane ${colIndex + 1}`;
    const columnCount = Math.max(
      colIndex + 1,
      laneLabels.length,
      ...nodes.map((node) => columnIndexOf(node.x) + 1),
      1,
    );
    const conflict = findLaneLabelConflict(laneLabels, colIndex, nextLabel, columnCount);
    if (conflict !== null) {
      const existingLabel = effectiveLaneLabel(laneLabels, conflict);
      window.alert(
        `Lane name "${nextLabel}" is already used by column ${conflict + 1} ("${existingLabel}").`,
      );
      return false;
    }

    const nextLaneLabels = [...laneLabels];
    while (nextLaneLabels.length < colIndex) {
      nextLaneLabels.push(`Lane ${nextLaneLabels.length + 1}`);
    }
    nextLaneLabels[colIndex] = nextLabel;
    const newNodes = nodes.map((node) => (
      columnIndexOf(node.x) === colIndex ? { ...node, lane: nextLabel } : node
    ));
    setLaneLabels(nextLaneLabels);
    setNodes(newNodes);
    if (activeWorkflowId) {
      setWorkflows((prev) => prev.map((workflow) => (
        workflow.id === activeWorkflowId
          ? { ...workflow, nodes: newNodes, laneLabels: nextLaneLabels }
          : workflow
      )));
    }
    return true;
  }, [activeWorkflowId, laneLabels, nodes]);

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
        resourceAccesses: undefined,
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
        }
        applyRunEvent(event);
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
  const executeSingleNode = async (nodeId: string, manualInput?: string) => {
    const nodeToRun = nodes.find((n) => n.id === nodeId);
    if (!nodeToRun || !activeWorkflowId) return;

    console.log('[runSingleNode] start', { nodeId, hasManualInput: manualInput !== undefined });

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

    if (manualInput !== undefined) {
      setLastManualInputs((previous) => ({ ...previous, [nodeId]: manualInput }));
    } else {
      setLastManualInputs((previous) => {
        if (!(nodeId in previous)) return previous;
        const next = { ...previous };
        delete next[nodeId];
        return next;
      });
    }

    await flushSave();

    try {
      const rec = await api.runSingleNode(activeWorkflowId, nodeId, {
        input,
        nodeOutputs,
      }, (runId) => {
        setSingleRunIds((previous) => ({ ...previous, [nodeId]: runId }));
      });
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                status: rec.status,
                output: rec.output,
                logs: rec.logs,
                resourceAccesses: rec.resourceAccesses,
                error: rec.error,
                executionTime: rec.executionTime,
              }
            : n
        )
      );
    } catch (e) {
      console.error('[runSingleNode] failed', { nodeId, error: (e as Error).message });
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, status: 'error', error: (e as Error).message } : n
        )
      );
    }
  };

  const handleRunSingleNode = (nodeId: string, manualInput?: string) => {
    if (manualInput !== undefined) {
      void executeSingleNode(nodeId, manualInput);
      return;
    }

    const hasData = hasUpstreamData(nodeId, edges, nodes);
    console.log('[runSingleNode] check upstream', { nodeId, hasData });
    if (!hasData) {
      setManualInputPromptNodeId(nodeId);
      return;
    }

    void executeSingleNode(nodeId);
  };

  const activeWorkflow = workflows.find((w) => w.id === activeWorkflowId);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const manualInputPromptNode = manualInputPromptNodeId
    ? nodes.find((n) => n.id === manualInputPromptNodeId) ?? null
    : null;

  if (currentView === 'home') {
    return (
      <>
        <HomePage
          workflows={workflows}
          initialFilterWorkflowId={historyFilterWorkflowId}
          initialHistoryContext={historyReturnContext}
          initialTab={homeInitialTab}
          onOpenWorkflow={handleOpenWorkflow}
          onDuplicateWorkflow={handleDuplicateWorkflow}
          onDeleteWorkflow={handleDeleteWorkflow}
          onEditWorkflowMeta={handleEditWorkflowMeta}
          onOpenRun={handleOpenRunDetail}
          onChangeTab={handleHomeTabChange}
        />
      </>
    );
  }

  if (currentView === 'run-detail' && selectedRunId) {
    return (
      <RunDetailPage
        runId={selectedRunId}
        onBack={handleBackFromRunDetail}
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
            lastManualInput={selectedNodeId ? lastManualInputs[selectedNodeId] ?? null : null}
            reuseOverwriteGeneratedAssets={reuseOverwriteGeneratedAssets}
            onUpdateReuseOverwriteGeneratedAssets={(value) => {
              console.log(
                `[App] reuseOverwriteGeneratedAssets → ${value} workflowId=${activeWorkflowId}`,
              );
              setReuseOverwriteGeneratedAssets(value);
              if (!activeWorkflowId) return;
              setWorkflows((prev) =>
                prev.map((workflow) => (
                  workflow.id === activeWorkflowId
                    ? { ...workflow, reuseOverwriteGeneratedAssets: value, updatedAt: nowLabel() }
                    : workflow
                ))
              );
            }}
          />
        </div>

        {manualInputPromptNode && (
          <ManualInputModal
            nodeTitle={manualInputPromptNode.title}
            onClose={() => setManualInputPromptNodeId(null)}
            onRun={(value) => {
              const nodeId = manualInputPromptNode.id;
              setManualInputPromptNodeId(null);
              void executeSingleNode(nodeId, value);
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
