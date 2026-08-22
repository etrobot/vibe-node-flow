import React, { useEffect, useMemo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  LayoutPanelLeft,
  Loader2,
} from 'lucide-react';
import type { FlowEdge, FlowNode } from '@/App/types';
import { getModule, getNodeDoc, nodeHasCustomPanel } from '@/App/registry';
import { NodeInspector } from '@/App/NodeInspector';
import { ErrorBoundary } from '@/App/components/ErrorBoundary';
import { renderLucideIcon } from './IconPicker';
import { SimpleMarkdown } from './NodeDocModal';
import { orderNodesByExecution } from '@/lib/execution-order';

interface AppLayoutViewProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onUpdateNode: (updatedNode: FlowNode) => void;
  onRunSingleNode: (nodeId: string, manualInput?: string) => void;
  readOnly?: boolean;
  workflowId?: string;
  runId?: string;
  lastManualInput?: string | null;
  reuseOverwriteGeneratedAssets?: boolean;
  onUpdateReuseOverwriteGeneratedAssets?: (value: boolean) => void;
  isInspectorCollapsed?: boolean;
  onToggleInspectorCollapse?: () => void;
}

const nodeStatusClass = (node: FlowNode, isSelected: boolean): string => {
  if (isSelected) return 'border-primary ring-1 ring-primary';
  if (node.status === 'running') return 'border-timeline-done ring-2 ring-timeline-done/20 animate-pulse';
  if (node.status === 'success') return 'border-timeline-grep';
  if (node.status === 'warning') return 'border-semantic-warning';
  if (node.status === 'error') return 'border-semantic-error';
  return 'border-hairline hover:border-hairline-strong';
};

export const AppLayoutView: React.FC<AppLayoutViewProps> = ({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onUpdateNode,
  onRunSingleNode,
  readOnly = false,
  workflowId,
  runId,
  lastManualInput = null,
  reuseOverwriteGeneratedAssets = false,
  onUpdateReuseOverwriteGeneratedAssets,
  isInspectorCollapsed = false,
  onToggleInspectorCollapse,
}) => {
  const orderedNodes = useMemo(
    () => orderNodesByExecution(nodes, edges),
    [nodes, edges],
  );
  const orderedIdsKey = orderedNodes.map((node) => node.id).join(',');

  useEffect(() => {
    console.log('[app-layout] node order', {
      count: orderedIdsKey ? orderedIdsKey.split(',').length : 0,
      ids: orderedIdsKey ? orderedIdsKey.split(',') : [],
    });
  }, [orderedIdsKey]);

  useEffect(() => {
    if (orderedNodes.length === 0) {
      if (selectedNodeId) {
        console.log('[app-layout] no nodes, clear selection');
        onSelectNode(null);
      }
      return;
    }
    const stillValid = Boolean(selectedNodeId && orderedNodes.some((node) => node.id === selectedNodeId));
    if (stillValid) return;
    const firstId = orderedNodes[0].id;
    console.log('[app-layout] auto-select first node', {
      previous: selectedNodeId,
      next: firstId,
      title: orderedNodes[0].title,
    });
    onSelectNode(firstId);
  }, [orderedNodes, selectedNodeId, onSelectNode]);

  const selectedNode = orderedNodes.find((node) => node.id === selectedNodeId) || null;
  const activeModule = selectedNode ? getModule(selectedNode.type) : null;
  const CustomView = activeModule?.CustomView;
  const OutputView = activeModule?.OutputView;
  const RenderPage = activeModule?.RenderPage;
  const hasCustomPanel = nodeHasCustomPanel(selectedNode);
  const nodeDoc = selectedNode ? getNodeDoc(selectedNode.type) : null;

  useEffect(() => {
    console.log('[app-layout] selected node', {
      nodeId: selectedNode?.id ?? null,
      title: selectedNode?.title ?? null,
      type: selectedNode?.type ?? null,
      hasCustomPanel,
      hasNodeDoc: Boolean(nodeDoc),
      nodeDocChars: nodeDoc?.length ?? 0,
      customView: Boolean(CustomView),
      outputView: Boolean(OutputView),
      renderPage: Boolean(RenderPage),
    });
  }, [selectedNode?.id, selectedNode?.title, selectedNode?.type, hasCustomPanel, nodeDoc, CustomView, OutputView, RenderPage]);

  const editorProps = selectedNode
    ? {
        node: selectedNode,
        allNodes: nodes,
        edges,
        onUpdateNode,
        onRunSingleNode,
        workflowId,
        runId,
        readOnly,
      }
    : null;

  return (
    <div className="relative z-10 flex-1 flex min-h-0 overflow-hidden">
      <aside className="relative z-30 w-12 shrink-0 h-full border-r border-hairline bg-surface-canvas flex flex-col items-center py-2 gap-1.5 overflow-y-auto custom-scrollbar">
        {orderedNodes.length === 0 ? (
          <div className="text-muted mt-3" title="No nodes">
            <LayoutPanelLeft className="w-4 h-4" />
          </div>
        ) : orderedNodes.map((node) => {
          const nodeModule = getModule(node.type);
          const isSelected = node.id === selectedNodeId;
          return (
            <button
              key={node.id}
              type="button"
              title={node.title}
              aria-label={node.title}
              aria-pressed={isSelected}
              onClick={() => {
                console.log('[app-layout] click node', { nodeId: node.id, title: node.title });
                onSelectNode(node.id);
              }}
              className={`relative w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-all cursor-pointer ${nodeStatusClass(node, isSelected)}`}
              style={{
                backgroundColor: `${node.color || nodeModule.color}12`,
                color: node.color || nodeModule.color,
              }}
            >
              {renderLucideIcon(node.icon, 'w-4 h-4')}
              {node.status === 'running' && (
                <span className="absolute -top-1 -right-1 bg-timeline-done text-on-primary rounded-full p-px">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                </span>
              )}
              {node.status === 'success' && (
                <span className="absolute -top-1 -right-1 bg-timeline-grep text-white rounded-full p-px">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                </span>
              )}
              {node.status === 'warning' && (
                <span className="absolute -top-1 -right-1 bg-semantic-warning text-white rounded-full leading-none px-0.5 text-[9px]">
                  !
                </span>
              )}
              {node.status === 'error' && (
                <span className="absolute -top-1 -right-1 bg-semantic-error text-white rounded-full p-px">
                  <AlertCircle className="w-2.5 h-2.5" />
                </span>
              )}
            </button>
          );
        })}
      </aside>

      <section className="relative z-10 flex-1 min-w-0 h-full bg-surface-canvas-soft/40 overflow-hidden flex flex-col">
        {!selectedNode || !activeModule || !editorProps ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 text-muted">
            <LayoutPanelLeft className="w-8 h-8 mb-3 opacity-60" />
            <h4 className="text-sm font-medium text-ink">No node selected</h4>
            <p className="text-xs mt-1 max-w-xs">Select a node from the left sidebar to view its custom panel.</p>
          </div>
        ) : (
          <ErrorBoundary key={selectedNode.id} label="AppLayoutCustomPanel">
            {CustomView ? (
              <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-4 md:p-6">
                <CustomView {...editorProps} />
              </div>
            ) : OutputView && hasCustomPanel ? (
              <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-4 md:p-6">
                <OutputView {...editorProps} />
              </div>
            ) : RenderPage ? (
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <RenderPage />
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-4 md:p-6">
                {nodeDoc ? (
                  <>
                    <p className="mb-3 font-mono text-[11px] text-muted">NODE.md · {selectedNode.type}</p>
                    <SimpleMarkdown source={nodeDoc} />
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-6 text-muted min-h-[40vh]">
                    <div
                      className="w-12 h-12 rounded-2xl border flex items-center justify-center mb-3"
                      style={{
                        backgroundColor: `${selectedNode.color || activeModule.color}12`,
                        borderColor: `${selectedNode.color || activeModule.color}35`,
                        color: selectedNode.color || activeModule.color,
                      }}
                    >
                      {renderLucideIcon(selectedNode.icon, 'w-6 h-6')}
                    </div>
                    <h4 className="text-sm font-medium text-ink">{selectedNode.title}</h4>
                    <p className="text-xs mt-1 max-w-xs">This node has no custom panel and no NODE.md.</p>
                  </div>
                )}
              </div>
            )}
          </ErrorBoundary>
        )}
      </section>

      <div className="shrink-0 max-sm:w-0 max-sm:overflow-visible">
      <NodeInspector
        node={selectedNode}
        allNodes={nodes}
        edges={edges}
        onUpdateNode={onUpdateNode}
        onRunSingleNode={onRunSingleNode}
        isCollapsed={isInspectorCollapsed}
        onToggleCollapse={() => {
          console.log('[app-layout] toggle node panel', { nextCollapsed: !isInspectorCollapsed });
          onToggleInspectorCollapse?.();
        }}
        readOnly={readOnly}
        workflowId={workflowId}
        runId={runId}
        lastManualInput={lastManualInput}
        reuseOverwriteGeneratedAssets={reuseOverwriteGeneratedAssets}
        onUpdateReuseOverwriteGeneratedAssets={onUpdateReuseOverwriteGeneratedAssets}
        variant="column"
      />
      </div>
    </div>
  );
};
