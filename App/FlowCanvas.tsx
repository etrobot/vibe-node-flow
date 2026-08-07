import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FlowNode, FlowEdge } from '@/App/types';
import { renderLucideIcon } from '@/App/components/ui/IconPicker';
import { NodeTagManagerModal } from '@/App/components/ui/NodeTagManagerModal';
import { getModule } from './registry';
import {
  DEFAULT_NODE_TAG_CATALOG,
  getNodeTagColors,
  mergeNodeTagCatalog,
  uniqueNodeTags,
} from '@/lib/workflow-tags';
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
  LANE_HEADER_HEIGHT,
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
  Plus,
  Tags,
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
  tagCatalog?: string[];
  onUpdateNodeTags?: (nodeId: string, tags: string[]) => void;
  onAddNodeTag?: (nodeId: string, tag: string) => void;
  onDeleteNodeTag?: (tag: string) => void;
  /** Custom lane labels keyed by canvas column index. */
  laneLabels?: string[];
  /** Commit an edited lane label for the given column index. Return false to keep editing. */
  onUpdateLaneLabel?: (colIndex: number, label: string) => boolean;
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
  tagCatalog = [...DEFAULT_NODE_TAG_CATALOG],
  onUpdateNodeTags,
  onAddNodeTag,
  onDeleteNodeTag,
  laneLabels,
  onUpdateLaneLabel,
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

  // --- Lane label editing state ---
  const [editingLane, setEditingLane] = useState<number | null>(null);
  const [laneDraft, setLaneDraft] = useState('');
  const laneInputRef = useRef<HTMLInputElement>(null);

  // Focus the lane input whenever editing starts
  useEffect(() => {
    if (editingLane !== null) {
      laneInputRef.current?.focus();
      laneInputRef.current?.select();
    }
  }, [editingLane]);

  const beginEditLane = (colIndex: number) => {
    if (readOnly || !onUpdateLaneLabel) return;
    const current = laneLabels?.[colIndex] ?? `Lane ${colIndex + 1}`;
    const centerX = columnX(colIndex) + NODE_WIDTH / 2;
    // Keep input in the same HTML transform layer as nodes — SVG foreignObject
    // under CSS scale/translate drifts far from the label in WebKit/Blink.
    const inputTop = TOP_MARGIN - 44;
    const inputLeft = centerX - 70;
    console.log('[lane-label-edit] begin', {
      colIndex,
      current,
      centerX,
      inputTop,
      inputLeft,
      pan,
      zoom,
    });
    setLaneDraft(current);
    setEditingLane(colIndex);
  };

  const commitLaneEdit = () => {
    if (editingLane === null) return;
    const trimmed = laneDraft.trim();
    // Empty draft falls back to the default "Lane N"
    const next = trimmed || `Lane ${editingLane + 1}`;
    const accepted = onUpdateLaneLabel?.(editingLane, next);
    if (accepted === false) return;
    setEditingLane(null);
    setLaneDraft('');
  };

  const cancelLaneEdit = () => {
    setEditingLane(null);
    setLaneDraft('');
  };

  // Double-click handler on the canvas root. Converts the click point to world
  // coordinates and hit-tests against each lane header's box (centered above
  // its column, width = NODE_WIDTH, height ~28px). This avoids putting any
  // pointer-events on the <text> elements, so node dragging / canvas panning
  // are never blocked even when a node is snapped to the top row.
  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    if (readOnly || !onUpdateLaneLabel) return;
    // Ignore double-clicks that originate on a node or UI control
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-pan]') || target.closest('input, button')) return;

    const { x: worldX, y: worldY } = clientToWorld(e.clientX, e.clientY);
    const laneTop = TOP_MARGIN - 48;       // top edge of the hit box
    const laneBottom = TOP_MARGIN - 20;    // bottom edge of the hit box
    if (worldY < laneTop || worldY > laneBottom) return;

    const halfWidth = NODE_WIDTH / 2 + 8;  // a little forgiving on the sides
    for (let i = 0; i < columnCount; i++) {
      const centerX = columnX(i) + NODE_WIDTH / 2;
      if (Math.abs(worldX - centerX) <= halfWidth) {
        beginEditLane(i);
        return;
      }
    }
  };

  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // --- Minimap dragging state ---
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false);
  const minimapRef = useRef<HTMLDivElement>(null);

  // --- Global-operation tag management state ---
  const [managingTagsNodeId, setManagingTagsNodeId] = useState<string | null>(null);
  const managingTagsNode = nodes.find((node) => node.id === managingTagsNodeId) ?? null;
  const resolvedTagCatalog = mergeNodeTagCatalog(
    tagCatalog,
    nodes.flatMap((node) => node.tags ?? []),
  );

  useEffect(() => {
    if (managingTagsNodeId && !managingTagsNode) setManagingTagsNodeId(null);
  }, [managingTagsNode, managingTagsNodeId]);

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
      const newY = Math.max(TOP_MARGIN - LANE_HEADER_HEIGHT, currentY - dragOffset.y);
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

  const ICON_CARD_SIZE = 56;

  const getNodePorts = (node: FlowNode) => {
    const iconCardXOffset = (NODE_WIDTH - ICON_CARD_SIZE) / 2;
    return {
      input: { x: node.x + iconCardXOffset, y: node.y + ICON_CARD_SIZE / 2 },
      output: { x: node.x + iconCardXOffset + ICON_CARD_SIZE, y: node.y + ICON_CARD_SIZE / 2 },
    };
  };

  // Render enough columns for both nodes and explicitly named lanes. A node
  // whose lane name maps to a later column must still have a visible guide.
  const columnCount = Math.max(
    nodes.length,
    laneLabels?.length ?? 0,
    ...nodes.map((node) => columnIndexOf(node.x) + 1),
  );

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

      // Step column header label at top of each column. The label is purely
      // visual (pointer-events disabled) so it never blocks canvas panning or
      // node dragging, even when a node is snapped to the top row beneath it.
      // Editing is triggered via double-click hit-testing on canvas coordinates
      // (see handleCanvasDoubleClick); the input overlay is HTML (not foreignObject).
      const laneLabel = laneLabels?.[i] ?? `Lane ${i + 1}`;
      if (editingLane === i) {
        // Text is replaced by the HTML input overlay while editing.
        continue;
      }
      guides.push(
        <text
          key={`col-header-${i}`}
          x={centerX}
          y={TOP_MARGIN - 31}
          textAnchor="middle"
          className="fill-gray-400 font-mono select-none"
          fontSize={11}
        >
          {laneLabel}
        </text>
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
    const sourceTop = from.y - 28;
    const sourceBottom = from.y + 28;
    const targetTop = to.y - 28;
    const targetBottom = to.y + 28;
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

  // Touch pan & drag support for mobile touch screens
  const touchStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({ x: 0, y: 0, panX: 0, panY: 0 });

  const handleTouchStartCanvas = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const target = e.target as HTMLElement;
      const isNodeOrControl = target.closest('[data-no-pan]');

      if (!isNodeOrControl) {
        setIsPanningCanvas(true);
        touchStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          panX: pan.x,
          panY: pan.y,
        };
        didDragRef.current = false;
      }
    }
  };

  const handleTouchMoveCanvas = (e: React.TouchEvent) => {
    if (isPanningCanvas && e.touches.length === 1) {
      didDragRef.current = true;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      setPan({
        x: touchStartRef.current.panX + dx,
        y: touchStartRef.current.panY + dy,
      });
    } else if (!readOnly && draggingNodeId && e.touches.length === 1) {
      didDragRef.current = true;
      const touch = e.touches[0];
      const { x: currentX, y: currentY } = clientToWorld(touch.clientX, touch.clientY);
      const draggedCol = columnIndexOf(currentX - dragOffset.x);
      const newX = columnX(draggedCol);
      const newY = Math.max(TOP_MARGIN - LANE_HEADER_HEIGHT, currentY - dragOffset.y);
      onUpdateNodePosition(draggingNodeId, newX, newY);
    }
  };

  const handleTouchEndCanvas = () => {
    handleMouseUp();
  };

  return (
    <div
      ref={canvasRef}
      onMouseDown={handleMouseDownCanvas}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleCanvasDoubleClick}
      onTouchStart={handleTouchStartCanvas}
      onTouchMove={handleTouchMoveCanvas}
      onTouchEnd={handleTouchEndCanvas}
      onClick={(e) => {
        if (e.target === e.currentTarget || (canvasRef.current && e.target === canvasRef.current.firstElementChild)) {
          if (!didDragRef.current) onSelectNode(null);
        }
        didDragRef.current = false;
      }}
      className={`relative w-full h-full bg-surface-canvas overflow-hidden select-none touch-none ${
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

        {/* Lane label edit overlay — HTML absolute (same transform as nodes).
            SVG foreignObject under CSS pan/zoom scale mis-positions the input. */}
        {editingLane !== null && (
          <input
            ref={laneInputRef}
            data-no-pan="true"
            value={laneDraft}
            onChange={(e) => setLaneDraft(e.target.value)}
            onBlur={commitLaneEdit}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitLaneEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelLaneEdit();
              }
            }}
            style={{
              left: `${columnX(editingLane) + NODE_WIDTH / 2 - 70}px`,
              top: `${TOP_MARGIN - 44}px`,
              width: '140px',
              height: '24px',
            }}
            className="absolute z-30 px-1.5 text-center text-[11px] font-mono text-ink bg-white border border-hairline-strong rounded outline-none focus:ring-1 focus:ring-primary/40 pointer-events-auto"
          />
        )}

        {/* Nodes Layer */}
        <div className="absolute inset-0 pointer-events-none z-20">
          {nodes.map((node) => {
            const nodeModule = getModule(node.type);
            const isSelected = selectedNodeId === node.id;
            const isConnecting = connectingFromId !== null;
            const selectedTags = uniqueNodeTags(node.tags);
            const visibleTags = selectedTags.slice(0, 3);
            const hiddenTagCount = Math.max(0, selectedTags.length - visibleTags.length);

            return (
              <div
                key={node.id}
                data-no-pan="true"
                onMouseDown={(e) => handleNodeMouseDown(e, node)}
                onClick={(e) => { e.stopPropagation(); onSelectNode(node.id); }}
                style={{ left: `${node.x}px`, top: `${node.y}px`, width: `${NODE_WIDTH}px` }}
                className={`absolute flex flex-col items-center group select-none pointer-events-auto ${readOnly ? 'cursor-pointer' : 'cursor-move'}`}
              >
                {/* Top Icon Card Block */}
                <div className="relative">
                  {/* Execution time badge - top right */}
                  {node.executionTime !== undefined && (
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-50">
                      <span className="text-[10px] font-mono text-muted whitespace-nowrap">
                        {(node.executionTime / 1000).toFixed(1)}s
                      </span>
                    </div>
                  )}

                  {/* Run button - centered above node icon card */}
                  {!readOnly && (
                    <div
                      onMouseDown={(e) => e.stopPropagation()}
                      className={`absolute -top-7 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-surface-card border border-hairline rounded-pill px-1.5 py-0.5 transition-all ${
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

                  {/* Clean Square Icon Tile */}
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-200 bg-surface-card border shadow-2xs ${
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
                    style={{
                      backgroundColor: `${node.color || nodeModule.color}12`,
                      color: node.color || nodeModule.color,
                    }}
                  >
                    {renderLucideIcon(node.icon, 'w-6 h-6')}
                  </div>

                  {/* Status Indicator Badges */}
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
                    className={`absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface-card border border-hairline flex items-center justify-center transition-all group/port z-40 ${readOnly ? 'cursor-default' : 'hover:border-primary hover:bg-primary cursor-pointer'}`}
                  >
                    <div className="w-1 h-1 rounded-full bg-muted group-hover/port:bg-white transition-colors" />
                  </div>

                  {/* Right (Output) Port */}
                  <div
                    onMouseDown={(e) => handleStartConnect(e, node.id)}
                    className={`absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface-card border border-hairline flex items-center justify-center transition-all group/port z-40 ${readOnly ? 'cursor-default' : 'hover:border-primary hover:bg-primary cursor-pointer'}`}
                  >
                    <div className="w-1 h-1 rounded-full bg-muted group-hover/port:bg-white transition-colors" />
                  </div>
                </div>

                {/* Middle Text Label Block */}
                <div className="mt-1.5 w-full flex flex-col items-center justify-center text-center px-1">
                  <div className={`w-full text-xs font-medium tracking-tight whitespace-normal break-words leading-tight ${isSelected ? 'text-primary font-semibold' : 'text-ink'}`}>
                    {node.title}
                  </div>
                  {nodeModule.badge && (
                    <div className="w-full text-[10px] text-muted font-mono truncate mt-0.5">
                      {nodeModule.badge}
                    </div>
                  )}
                </div>

                {(selectedTags.length > 0 || !readOnly) && (
                  <div
                    className="mt-1 h-6 max-w-[220px] flex items-center justify-center gap-1 cursor-default"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {visibleTags.map((tag) => {
                      const colors = getNodeTagColors(tag);
                      return (
                        <button
                          key={tag.toLocaleLowerCase()}
                          type="button"
                          disabled={readOnly}
                          title={readOnly ? tag : `Manage global tags · ${tag}`}
                          onClick={() => setManagingTagsNodeId(node.id)}
                          className="h-5 max-w-[62px] truncate rounded-md border px-1.5 text-[9px] font-medium leading-none shadow-2xs transition-transform enabled:hover:-translate-y-0.5 enabled:cursor-pointer disabled:cursor-default"
                          style={{
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                            color: colors.foreground,
                          }}
                        >
                          {tag}
                        </button>
                      );
                    })}
                    {hiddenTagCount > 0 && (
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => setManagingTagsNodeId(node.id)}
                        title={`${hiddenTagCount} more tag${hiddenTagCount === 1 ? '' : 's'}`}
                        className="h-5 rounded-md border border-[#D9C9ED] bg-[#EEE5F8] px-1.5 text-[9px] font-medium leading-none text-[#604B7A] shadow-2xs enabled:cursor-pointer disabled:cursor-default"
                      >
                        +{hiddenTagCount}
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => setManagingTagsNodeId(node.id)}
                        title="Manage global operation tags"
                        aria-label={`Manage global operation tags for ${node.title}`}
                        className="h-5 min-w-5 rounded-md border border-hairline bg-surface-card px-1 text-[9px] text-muted shadow-2xs transition-colors hover:border-hairline-strong hover:text-ink cursor-pointer inline-flex items-center justify-center gap-1"
                      >
                        {selectedTags.length === 0 && <Tags className="w-2.5 h-2.5" />}
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Interactive Floating Minimap & Navigation Controls Panel */}
      <div data-no-pan="true" className="absolute bottom-3 left-3 sm:bottom-5 sm:left-5 z-40 flex flex-col gap-2 p-1.5 sm:p-2 bg-surface-card/95 border border-hairline rounded-xl shadow-lg backdrop-blur-md">
        {/* Interactive Canvas Minimap - Hidden on small mobile screens (<640px) to prevent covering canvas */}
        <div
          ref={minimapRef}
          onPointerDown={handleMinimapPointerDown}
          onPointerMove={handleMinimapPointerMove}
          onPointerUp={handleMinimapPointerUp}
          style={{ width: `${minimapWidth}px`, height: `${minimapHeight}px` }}
          className="hidden sm:block relative rounded-lg bg-surface-canvas border border-hairline overflow-hidden cursor-crosshair select-none touch-none"
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

      {!readOnly && managingTagsNode && (
        <NodeTagManagerModal
          nodeTitle={managingTagsNode.title}
          catalog={resolvedTagCatalog}
          selectedTags={uniqueNodeTags(managingTagsNode.tags)}
          onToggleTag={(tag) => {
            const key = tag.toLocaleLowerCase();
            const currentTags = uniqueNodeTags(managingTagsNode.tags);
            const isSelected = currentTags.some((selectedTag) => selectedTag.toLocaleLowerCase() === key);
            onUpdateNodeTags?.(
              managingTagsNode.id,
              isSelected
                ? currentTags.filter((selectedTag) => selectedTag.toLocaleLowerCase() !== key)
                : [...currentTags, tag],
            );
          }}
          onAddTag={(tag) => onAddNodeTag?.(managingTagsNode.id, tag)}
          onDeleteTag={(tag) => onDeleteNodeTag?.(tag)}
          onClose={() => setManagingTagsNodeId(null)}
        />
      )}
    </div>
  );
};
