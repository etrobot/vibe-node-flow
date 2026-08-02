import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FlowNode, FlowEdge } from '@/App/types';
import { renderLucideIcon } from '@/App/components/ui/IconPicker';
import { getModule } from '@/App/registry';
import {
  TOP_MARGIN,
  NODE_WIDTH,
  NODE_HEIGHT,
  COL_GAP,
  COL_SPACING,
  LEFT_MARGIN,
  MIN_COLUMNS,
  columnIndexOf,
  columnX,
  columnDividerX,
  LEFT_BOUNDARY,
  snapY,
} from '@/lib/canvas-layout';
import {
  Sparkles,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ZoomIn,
  ZoomOut,
  X,
  Clock,
  Maximize2,
  MapPin,
} from 'lucide-react';

interface FlowCanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onUpdateNodePosition: (id: string, x: number, y: number) => void;
  onConnect: (fromNodeId: string, toNodeId: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onRunSingleNode: (id: string) => void;
  isRunning: boolean;
  readOnly?: boolean;
}

export const FlowCanvas: React.FC<FlowCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onUpdateNodePosition,
  onConnect,
  onDeleteNode,
  onDeleteEdge,
  onRunSingleNode,
  isRunning,
  readOnly = false,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);

  // --- Zoom & Pan state ---
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanningCanvas, setIsPanningCanvas] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number }>({
    clientX: 0,
    clientY: 0,
    panX: 0,
    panY: 0,
  });

  // --- Node dragging state ---
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const didDragRef = useRef(false);

  // --- Edge connecting state ---
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // --- Minimap dragging state ---
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false);
  const minimapRef = useRef<HTMLDivElement>(null);

  // Convert client cursor coordinates to world canvas coordinates
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvasRef.current) return { x: 0, y: 0 };
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (clientX - rect.left - pan.x) / zoom;
      const y = (clientY - rect.top - pan.y) / zoom;
      return { x, y };
    },
    [pan.x, pan.y, zoom]
  );

  // Native wheel handler for trackpad pan & ctrl/pinch zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Pinch zoom
        const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
        setZoom((prevZoom) => {
          const nextZoom = Math.min(1.8, Math.max(0.4, prevZoom * zoomFactor));
          return Math.round(nextZoom * 100) / 100;
        });
      } else {
        // Pan canvas with wheel / trackpad scroll
        setPan((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    el.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', handleWheelNative);
  }, []);

  // Canvas background drag-to-pan handler
  const handleMouseDownCanvas = (e: React.MouseEvent) => {
    // Check if the click target is a node, port, or UI toolbar control
    const target = e.target as HTMLElement;
    const isNodeOrControl = target.closest('[data-no-pan]');

    if (!isNodeOrControl && (e.button === 0 || e.button === 1)) {
      setIsPanningCanvas(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      didDragRef.current = false;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanningCanvas) {
      didDragRef.current = true;
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
      return;
    }

    const { x: currentX, y: currentY } = clientToWorld(e.clientX, e.clientY);
    setMousePos({ x: currentX, y: currentY });

    if (!readOnly && draggingNodeId) {
      didDragRef.current = true;
      const draggedCol = columnIndexOf(currentX - dragOffset.x);
      const newX = columnX(draggedCol);
      const newY = Math.max(TOP_MARGIN, currentY - dragOffset.y);
      onUpdateNodePosition(draggingNodeId, newX, newY);
    }
  };

  const handleMouseUp = () => {
    if (isPanningCanvas) {
      setIsPanningCanvas(false);
    }
    if (!readOnly && draggingNodeId) {
      const node = nodes.find((n) => n.id === draggingNodeId);
      if (node) {
        const snappedX = columnX(columnIndexOf(node.x));
        const snappedY = snapY(node.y);
        onUpdateNodePosition(draggingNodeId, snappedX, snappedY);
      }
    }
    setDraggingNodeId(null);
    setConnectingFromId(null);
  };

  const handleNodeMouseDown = (e: React.MouseEvent, node: FlowNode) => {
    e.stopPropagation();
    didDragRef.current = false;
    onSelectNode(node.id);
    if (readOnly) return;
    const { x: currentX, y: currentY } = clientToWorld(e.clientX, e.clientY);
    setDraggingNodeId(node.id);
    setDragOffset({ x: currentX - node.x, y: currentY - node.y });
  };

  const handleStartConnect = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (readOnly) return;
    setConnectingFromId(nodeId);
  };

  const handleEndConnect = (e: React.MouseEvent, targetNodeId: string) => {
    e.stopPropagation();
    if (readOnly) return;
    if (connectingFromId && connectingFromId !== targetNodeId) {
      onConnect(connectingFromId, targetNodeId);
    }
    setConnectingFromId(null);
  };

  const getNodePorts = (node: FlowNode) => {
    return {
      input: { x: node.x, y: node.y + NODE_HEIGHT / 2 },
      output: { x: node.x + NODE_WIDTH, y: node.y + NODE_HEIGHT / 2 },
    };
  };

  // Column count equals total number of nodes
  const columnCount = nodes.length;

  // Reusable vertical guide line helper
  const renderGuideLine = (key: string, x: number, dashArray?: string) => (
    <line
      key={key}
      x1={x}
      y1={-4000}
      x2={x}
      y2={4000}
      stroke="currentColor"
      className="text-hairline"
      strokeWidth={1}
      strokeDasharray={dashArray}
      opacity={0.64}
    />
  );

  // Render vertical lane dividers, column step headers, and zebra lane backgrounds
  const renderColumnGuides = () => {
    const guides = [];
    const minY = -4000;
    const maxY = 4000;

    // Render left boundary line before Column 0
    guides.push(renderGuideLine('col-boundary-left', LEFT_BOUNDARY));

    for (let i = 0; i < columnCount; i++) {
      const colLeft = columnX(i) - COL_GAP / 2;
      const colWidth = COL_SPACING;
      const dividerX = columnDividerX(i);
      const centerX = columnX(i) + NODE_WIDTH / 2;

      // Subtle alternating zebra lane shading
      if (i % 2 === 0) {
        guides.push(
          <rect
            key={`col-bg-${i}`}
            x={colLeft}
            y={minY}
            width={colWidth}
            height={maxY - minY}
            fill="currentColor"
            className="text-hairline"
            opacity={0.08}
          />
        );
      }

      // Vertical lane divider line between adjacent step columns
      guides.push(renderGuideLine(`col-divider-${i}`, dividerX));

      // Center alignment guideline for cards inside the column
      guides.push(renderGuideLine(`col-center-${i}`, centerX, '4 6'));

      // Step column header label at top of each column
      guides.push(
        <g key={`col-header-group-${i}`}>
          <text
            x={centerX}
            y={TOP_MARGIN - 31}
            textAnchor="middle"
            className="fill-gray-400 font-mono"
            fontSize={11}
          >
            {`Lane ${i + 1}`}
          </text>
        </g>
      );
    }
    return guides;
  };

  /**
   * Generates an n8n-style rounded orthogonal (Manhattan) path with soft corner arcs
   */
  const getRoundedOrthogonalPath = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    cornerRadius = 12
  ): { pathD: string; label: { x: number; y: number } } => {
    const { x: x1, y: y1 } = from;
    const { x: x2, y: y2 } = to;

    const midX = (x1 + x2) / 2;
    const dy = y2 - y1;
    const dx = x2 - x1;

    // Straight horizontal line if ports are vertically aligned
    if (Math.abs(dy) < 1) {
      return {
        pathD: `M ${x1} ${y1} L ${x2} ${y2}`,
        label: { x: midX, y: y1 },
      };
    }

    const r = Math.min(cornerRadius, Math.abs(midX - x1), Math.abs(dy) / 2);
    const sweepY = dy > 0 ? 1 : 0;

    const pathD = [
      `M ${x1} ${y1}`,
      `L ${midX - r} ${y1}`,
      `A ${r} ${r} 0 0 ${sweepY} ${midX} ${y1 + (dy > 0 ? r : -r)}`,
      `L ${midX} ${y2 - (dy > 0 ? r : -r)}`,
      `A ${r} ${r} 0 0 ${sweepY === 1 ? 0 : 1} ${midX + r} ${y2}`,
      `L ${x2} ${y2}`,
    ].join(' ');

    return {
      pathD,
      label: { x: midX, y: (y1 + y2) / 2 },
    };
  };

  const getSameColumnPath = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): { pathD: string; label: { x: number; y: number } } => {
    const clearance = 12;
    const rightOfSource = from.x + clearance;
    const leftOfTarget = to.x - clearance;
    const sourceTop = from.y - NODE_HEIGHT / 2;
    const sourceBottom = from.y + NODE_HEIGHT / 2;
    const targetTop = to.y - NODE_HEIGHT / 2;
    const targetBottom = to.y + NODE_HEIGHT / 2;
    const gapBetween = to.y > from.y
      ? targetTop - sourceBottom
      : sourceTop - targetBottom;

    let routeY: number;
    if (gapBetween >= clearance * 2) {
      // The gap between the cards is the shortest collision-free route.
      routeY = to.y > from.y
        ? (sourceBottom + targetTop) / 2
        : (targetBottom + sourceTop) / 2;
    } else {
      // Overlapping cards have no safe middle channel. Pick the shorter outer route.
      const topRoute = Math.min(sourceTop, targetTop) - clearance;
      const bottomRoute = Math.max(sourceBottom, targetBottom) + clearance;
      const topDistance = Math.abs(from.y - topRoute) + Math.abs(to.y - topRoute);
      const bottomDistance = Math.abs(from.y - bottomRoute) + Math.abs(to.y - bottomRoute);
      routeY = topDistance <= bottomDistance ? topRoute : bottomRoute;
    }

    return {
      pathD: [
        `M ${from.x} ${from.y}`,
        `L ${rightOfSource} ${from.y}`,
        `L ${rightOfSource} ${routeY}`,
        `L ${leftOfTarget} ${routeY}`,
        `L ${leftOfTarget} ${to.y}`,
        `L ${to.x} ${to.y}`,
      ].join(' '),
      label: { x: (leftOfTarget + rightOfSource) / 2, y: routeY },
    };
  };

  const renderEdge = (
    edge: FlowEdge,
    fromPos: { x: number; y: number },
    toPos: { x: number; y: number },
    sameColumn = false,
  ) => {
    const { pathD, label } = sameColumn
      ? getSameColumnPath(fromPos, toPos)
      : getRoundedOrthogonalPath(fromPos, toPos);
    const isRunning = edge.status === 'running';
    const isSuccess = edge.status === 'success';
    const isWarning = edge.status === 'warning';
    const isError = edge.status === 'error';

    const strokeColor = isRunning
      ? '#f54e00'
      : isSuccess
      ? '#1f8a65'
      : isWarning
      ? '#c08532'
      : isError
      ? '#cf2d56'
      : '#26251e';

    return (
      <g key={edge.id} className="group/edge">
        {/* Wider invisible stroke to make clicking & hover deletion easy */}
        <path
          d={pathD}
          fill="none"
          stroke="transparent"
          strokeWidth={18}
          className={`${readOnly ? 'cursor-default' : 'cursor-pointer'} pointer-events-stroke`}
          onClick={(e) => {
            e.stopPropagation();
            if (!readOnly) onDeleteEdge(edge.id);
          }}
        />

        {/* Outer glow during active execution */}
        {isRunning && (
          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth={5}
            opacity={0.3}
            className="animate-pulse"
          />
        )}

        {/* Main visible connection line */}
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2.5}
          strokeDasharray="6 6"
          strokeLinecap="round"
          className={`transition-all duration-300 ${
            isRunning ? 'ant-line-running' : readOnly ? '' : 'group-hover/edge:stroke-black'
          }`}
        />

        {/* Delete Edge badge button on hover */}
        {!readOnly && (
          <g
            transform={`translate(${label.x}, ${label.y})`}
            className="opacity-0 group-hover/edge:opacity-100 transition-opacity cursor-pointer pointer-events-auto"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteEdge(edge.id);
            }}
          >
            <circle r={9} fill="#ffffff" stroke="#cfcdc4" strokeWidth={1} />
            <X className="w-3 h-3 -translate-x-1.5 -translate-y-1.5 text-muted hover:text-semantic-error transition-colors" />
          </g>
        )}
      </g>
    );
  };

  // --- Minimap Calculations ---
  const minimapWidth = 200;
  const minimapHeight = 120;
  const contentWidthWorld = Math.max(2000, columnCount * COL_SPACING + 400);
  const contentHeightWorld = 1200;
  const minimapScale = minimapWidth / contentWidthWorld;

  // Viewport calculation for minimap
  const viewportWidthWorld = canvasRef.current ? canvasRef.current.clientWidth / zoom : 1000;
  const viewportHeightWorld = canvasRef.current ? canvasRef.current.clientHeight / zoom : 600;

  const viewportMiniX = Math.max(0, -pan.x / zoom * minimapScale);
  const viewportMiniY = Math.max(0, -pan.y / zoom * minimapScale);
  const viewportMiniW = Math.min(minimapWidth, viewportWidthWorld * minimapScale);
  const viewportMiniH = Math.min(minimapHeight, viewportHeightWorld * minimapScale);

  const updatePanFromMinimapPointer = (clientX: number, clientY: number) => {
    if (!minimapRef.current) return;
    const rect = minimapRef.current.getBoundingClientRect();
    const miniClickX = Math.max(0, Math.min(minimapWidth, clientX - rect.left));
    const miniClickY = Math.max(0, Math.min(minimapHeight, clientY - rect.top));

    const targetWorldX = miniClickX / minimapScale - viewportWidthWorld / 2;
    const targetWorldY = miniClickY / minimapScale - viewportHeightWorld / 2;

    setPan({
      x: -targetWorldX * zoom,
      y: -targetWorldY * zoom,
    });
  };

  const handleMinimapPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingMinimap(true);
    updatePanFromMinimapPointer(e.clientX, e.clientY);
  };

  const handleMinimapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingMinimap) {
      e.stopPropagation();
      updatePanFromMinimapPointer(e.clientX, e.clientY);
    }
  };

  const handleMinimapPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingMinimap) {
      e.stopPropagation();
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsDraggingMinimap(false);
    }
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      ref={canvasRef}
      onMouseDown={handleMouseDownCanvas}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={(e) => {
        if (e.target === e.currentTarget || (canvasRef.current && e.target === canvasRef.current.firstElementChild)) {
          if (!didDragRef.current) onSelectNode(null);
        }
        didDragRef.current = false;
      }}
      className={`relative w-full h-full bg-surface-canvas overflow-hidden select-none ${
        isPanningCanvas ? 'cursor-grabbing' : readOnly ? 'cursor-default' : 'cursor-crosshair'
      }`}
    >
      {/* Zoom + Pan transformed container */}
      <div
        className="w-full h-full relative origin-top-left transition-transform duration-75"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {/* Scaled Background Grid Layer */}
        <div
          className="absolute bg-grid-pattern pointer-events-none z-0"
          style={{
            left: '-2000px',
            top: '-2000px',
            width: '8000px',
            height: '8000px',
          }}
        />

        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible">
          <defs>
            <linearGradient id="gradient-default" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#26251e" />
              <stop offset="100%" stopColor="#5a5852" />
            </linearGradient>
          </defs>
          {renderColumnGuides()}
          {edges.map((edge) => {
            const fromNode = nodes.find((n) => n.id === edge.fromNodeId);
            const toNode = nodes.find((n) => n.id === edge.toNodeId);
            if (!fromNode || !toNode) return null;
            return renderEdge(
              edge,
              getNodePorts(fromNode).output,
              getNodePorts(toNode).input,
              columnIndexOf(fromNode.x) === columnIndexOf(toNode.x),
            );
          })}

          {/* Interactive line drawn during edge connection */}
          {connectingFromId && (() => {
            const fromNode = nodes.find((n) => n.id === connectingFromId);
            if (!fromNode) return null;
            const fromPos = getNodePorts(fromNode).output;
            const { pathD } = getRoundedOrthogonalPath(fromPos, mousePos);
            return (
              <path
                d={pathD}
                fill="none"
                stroke="#f54e00"
                strokeWidth={2}
                strokeDasharray="4 4"
                className="animate-pulse"
              />
            );
          })()}
        </svg>

        {/* Nodes Layer */}
        <div className="absolute inset-0 pointer-events-none z-20">
          {nodes.map((node) => {
            const nodeModule = getModule(node.type);
            const isSelected = selectedNodeId === node.id;
            const isConnecting = connectingFromId !== null;

            return (
              <div
                key={node.id}
                data-no-pan="true"
                onMouseDown={(e) => handleNodeMouseDown(e, node)}
                onClick={(e) => { e.stopPropagation(); onSelectNode(node.id); }}
                style={{ left: `${node.x}px`, top: `${node.y}px`, width: `${NODE_WIDTH}px` }}
                className={`absolute flex flex-col items-center group select-none pointer-events-auto ${readOnly ? 'cursor-pointer' : 'cursor-move'}`}
              >
                {/* Execution time badge - top right */}
                {node.executionTime !== undefined && (
                  <div className="absolute -top-9 right-0 z-50">
                    <span className="inline-flex items-center gap-1 bg-surface-card/95 border border-hairline px-2 py-0.5 rounded-pill text-[10px] font-mono text-muted shadow-2xs whitespace-nowrap">
                      <Clock className="w-2.5 h-2.5 text-primary" />
                      {(node.executionTime / 1000).toFixed(1)}s
                    </span>
                  </div>
                )}

                {/* Run button - centered above node */}
                {!readOnly && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`absolute -top-9 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-surface-card border border-hairline rounded-pill px-1.5 py-0.5 transition-all ${
                      isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto'
                    }`}
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onRunSingleNode(node.id); }}
                      title="Run this node alone"
                      className="p-1 rounded-full text-muted hover:text-primary hover:bg-primary-light transition-colors cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                    </button>
                  </div>
                )}

                <div
                  className={`relative w-[153px] h-[50px] px-3 rounded-lg flex items-center gap-2.5 transition-all duration-200 bg-surface-card border shadow-2xs ${
                    isSelected
                      ? 'border-black ring-2 ring-black/20 z-30'
                      : node.status === 'running'
                      ? 'border-timeline-done ring-2 ring-timeline-done/20 animate-pulse z-30'
                      : node.status === 'success'
                      ? 'border-timeline-grep hover:border-timeline-grep/80'
                      : node.status === 'warning'
                      ? 'border-semantic-warning hover:border-semantic-warning/80'
                      : node.status === 'error'
                      ? 'border-semantic-error hover:border-semantic-error/80'
                      : 'border-hairline hover:border-hairline-strong'
                  }`}
                >
                  <div style={{ color: node.color || nodeModule.color }}>
                    {renderLucideIcon(node.icon, 'w-4.5 h-4.5')}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className={`text-xs font-medium tracking-tight truncate ${isSelected ? 'text-primary font-medium' : 'text-ink'}`}>
                      {node.title}
                    </div>
                    <div className="text-[10px] text-muted font-mono truncate">
                      {nodeModule.badge}
                    </div>
                  </div>

                  {node.status === 'running' && (
                    <div className="absolute -top-1.5 -right-1.5 bg-timeline-done text-on-primary rounded-full p-0.5 z-40">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    </div>
                  )}
                  {node.status === 'success' && (
                    <div className="absolute -top-1.5 -right-1.5 bg-timeline-grep text-ink rounded-full p-0.5 z-40">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                  )}
                  {node.status === 'warning' && (
                    <div className="absolute -top-1.5 -right-1.5 bg-semantic-warning text-white rounded-full p-0.5 z-40">
                      <span className="text-[11px] leading-none">⚠️</span>
                    </div>
                  )}
                  {node.status === 'error' && (
                    <div className="absolute -top-1.5 -right-1.5 bg-semantic-error text-white rounded-full p-0.5 z-40">
                      <AlertCircle className="w-3.5 h-3.5" />
                    </div>
                  )}

                  {/* Left (Input) Port */}
                  <div
                    onMouseUp={(e) => handleEndConnect(e, node.id)}
                    className={`absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-surface-card border-2 border-hairline flex items-center justify-center transition-all group/port z-40 ${readOnly ? 'cursor-default' : 'hover:border-primary hover:bg-primary cursor-pointer'}`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-muted group-hover/port:bg-white transition-colors" />
                  </div>

                  {/* Right (Output) Port */}
                  <div
                    onMouseDown={(e) => handleStartConnect(e, node.id)}
                    className={`absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-surface-card border-2 border-hairline flex items-center justify-center transition-all group/port z-40 ${readOnly ? 'cursor-default' : 'hover:border-primary hover:bg-primary cursor-pointer'}`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-muted group-hover/port:bg-white transition-colors" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Interactive Floating Minimap & Navigation Controls Panel */}
      <div data-no-pan="true" className="absolute bottom-5 left-5 z-40 flex flex-col gap-2 p-2 bg-surface-card/95 border border-hairline rounded-xl shadow-lg backdrop-blur-md">
        {/* Interactive Canvas Minimap */}
        <div
          ref={minimapRef}
          onPointerDown={handleMinimapPointerDown}
          onPointerMove={handleMinimapPointerMove}
          onPointerUp={handleMinimapPointerUp}
          style={{ width: `${minimapWidth}px`, height: `${minimapHeight}px` }}
          className="relative rounded-lg bg-surface-canvas border border-hairline overflow-hidden cursor-crosshair select-none touch-none"
        >
          {/* Miniature Step Column Dividers */}
          {Array.from({ length: columnCount }).map((_, i) => {
            const miniDivX = columnDividerX(i) * minimapScale;
            return (
              <div
                key={`mini-div-${i}`}
                className="absolute top-0 bottom-0 border-r border-hairline/60"
                style={{ left: `${miniDivX}px` }}
              />
            );
          })}

          {/* Miniature Node Cards */}
          {nodes.map((node) => {
            const mx = node.x * minimapScale;
            const my = node.y * minimapScale;
            const mw = Math.max(6, NODE_WIDTH * minimapScale);
            const mh = Math.max(4, NODE_HEIGHT * minimapScale);
            const isSel = selectedNodeId === node.id;

            return (
              <div
                key={`mini-node-${node.id}`}
                className={`absolute rounded-xs transition-colors ${
                  isSel ? 'bg-primary ring-1 ring-black' : 'bg-hairline-strong/80 hover:bg-primary'
                }`}
                style={{
                  left: `${mx}px`,
                  top: `${my}px`,
                  width: `${mw}px`,
                  height: `${mh}px`,
                }}
              />
            );
          })}

          {/* Viewport Indicator Focus Frame */}
          <div
            className="absolute border-2 border-primary bg-primary/10 rounded-xs shadow-2xs pointer-events-none"
            style={{
              left: `${viewportMiniX}px`,
              top: `${viewportMiniY}px`,
              width: `${Math.max(16, viewportMiniW)}px`,
              height: `${Math.max(14, viewportMiniH)}px`,
            }}
          >
            <div className="absolute top-0.5 left-0.5 p-0.5 bg-primary text-white rounded-2xs">
              <MapPin className="w-2 h-2" />
            </div>
          </div>
        </div>

        {/* Zoom & Reset Toolbar */}
        <div className="flex items-center justify-between gap-1 pt-1 border-t border-hairline">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.min(1.8, Math.round((z + 0.1) * 10) / 10))}
              title="Zoom In"
              className="p-1.5 rounded-lg bg-surface-canvas-soft hover:bg-surface-card text-muted hover:text-ink border border-hairline transition-colors cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}
              title="Zoom Out"
              className="p-1.5 rounded-lg bg-surface-canvas-soft hover:bg-surface-card text-muted hover:text-ink border border-hairline transition-colors cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={resetView}
              title="Reset Zoom & Pan"
              className="px-2 py-1 rounded-lg bg-surface-canvas-soft hover:bg-surface-card text-muted hover:text-ink border border-hairline transition-colors font-mono text-[10px] cursor-pointer"
            >
              {Math.round(zoom * 100)}%
            </button>
          </div>

          <div className="text-[10px] text-muted font-mono px-1">
            {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
          </div>
        </div>
      </div>
    </div>
  );
};
