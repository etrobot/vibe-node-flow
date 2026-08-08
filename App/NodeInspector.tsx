import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FlowNode, FlowEdge } from '@/App/types';
import { renderLucideIcon } from '@/App/components/ui/IconPicker';
import { IconPickerModal } from '@/App/components/ui/IconPickerModal';
import { NodeDocModal } from '@/App/components/ui/NodeDocModal';
import { ErrorBoundary } from '@/App/components/ErrorBoundary';
import { getModule, getNodeDoc } from './registry';
import { resolveUpstreamInput } from '@/App/utils/upstream';
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Play,
  Copy,
  Check,
  Clock,
  AlertTriangle,
  Terminal,
  ExternalLink,
  Search,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  FileText,
  Filter,
  PencilLine,
  CircleHelp,
  X,
} from 'lucide-react';

interface NodeInspectorProps {
  node: FlowNode | null;
  allNodes: FlowNode[];
  edges: FlowEdge[];
  onUpdateNode: (updatedNode: FlowNode) => void;
  onRunSingleNode: (nodeId: string, manualInput?: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  readOnly?: boolean;
  workflowId?: string;
  runId?: string;
  lastManualInput?: string | null;
}

type LogCategory = 'all' | 'input' | 'output' | 'logs' | 'error';

interface UnifiedLogItem {
  id: string;
  category: 'input' | 'output' | 'logs' | 'error';
  title: string;
  content: any;
  timestamp?: string;
}

export const NodeInspector: React.FC<NodeInspectorProps> = ({
  node,
  allNodes,
  edges,
  onUpdateNode,
  onRunSingleNode,
  isCollapsed,
  onToggleCollapse,
  readOnly = false,
  workflowId,
  runId,
  lastManualInput = null,
}) => {
  const [filterCategory, setFilterCategory] = useState<LogCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showIconModal, setShowIconModal] = useState(false);
  const [showFullPanelModal, setShowFullPanelModal] = useState(false);
  const [showNodeDocModal, setShowNodeDocModal] = useState(false);
  const [nodeTitleDraft, setNodeTitleDraft] = useState(node?.title || '');
  const titleBeforeEditRef = useRef(node?.title || '');
  const [expandedItemId, setExpandedItemId] = useState<string | null>('console-logs');

  const activeModule = node ? getModule(node.type) : null;
  const nodeDoc = node ? getNodeDoc(node.type) : null;
  const hasCustomPanel = Boolean(
    activeModule?.CustomView || activeModule?.OutputView || activeModule?.RenderPage,
  );

  // Read/Save "openPanelOnClickNode" state in node.config
  const openPanelOnClickNode = Boolean(node?.config?.openPanelOnClickNode ?? false);

  // Auto-open full panel modal when node selection changes if openPanelOnClickNode is enabled
  useEffect(() => {
    if (node && hasCustomPanel && openPanelOnClickNode) {
      setShowFullPanelModal(true);
    } else {
      setShowFullPanelModal(false);
    }
  }, [node?.id, hasCustomPanel, openPanelOnClickNode]);

  // ESC key listener for Full Panel Modal
  useEffect(() => {
    if (!showFullPanelModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFullPanelModal(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showFullPanelModal]);

  // Reset accordion expansion when the selected node changes (default to expanding console-logs)
  useEffect(() => {
    setExpandedItemId('console-logs');
  }, [node?.id]);

  useEffect(() => {
    setNodeTitleDraft(node?.title || '');
  }, [node?.id, node?.title]);

  useEffect(() => {
    titleBeforeEditRef.current = node?.title || '';
  }, [node?.id]);

  const commitNodeTitle = (draft = nodeTitleDraft) => {
    if (!node || readOnly) return;
    const title = draft.trim();
    if (!title) {
      setNodeTitleDraft(node.title);
      return;
    }
    if (title !== node.title) onUpdateNode({ ...node, title });
  };

  const toggleOpenPanelOnClickNode = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!node) return;
    onUpdateNode({
      ...node,
      config: {
        ...(node.config || {}),
        openPanelOnClickNode: e.target.checked,
      },
    });
  };

  const handleSaveIconAndColor = (newIcon: string, newColor: string) => {
    if (!node) return;
    onUpdateNode({ ...node, icon: newIcon, color: newColor });
  };

  // Resolve upstream input for this node
  const upstreamInput = useMemo(() => {
    if (!node) return {};
    return resolveUpstreamInput(node.id, edges, allNodes);
  }, [node, edges, allNodes]);

  // Build unified log items array
  const logItems = useMemo<UnifiedLogItem[]>(() => {
    if (!node) return [];
    const items: UnifiedLogItem[] = [];

    // 1. Upstream Input — one expandable block per upstream edge so multi-input
    //    nodes show each source separately instead of bundling them together.
    const hasUpstream = edges.some((e) => e.toNodeId === node.id);
    if (lastManualInput !== null) {
      items.push({
        id: 'manual-input-data',
        category: 'input',
        title: 'Manual Input',
        content: lastManualInput || '(Empty input)',
      });
    } else if (hasUpstream) {
      const entries = Object.entries(upstreamInput);
      if (entries.length === 0) {
        items.push({
          id: 'input-data',
          category: 'input',
          title: 'Node Upstream Input',
          content: '(Empty input)',
        });
      } else {
        entries.forEach(([key, value]) => {
          const sourceNode = allNodes.find((n) => n.id === key);
          items.push({
            id: `input-${key}`,
            category: 'input',
            title: sourceNode?.title || key,
            content: value,
          });
        });
      }
    }

    // 2. Output
    if (node.output !== undefined && node.output !== null) {
      items.push({
        id: 'output-data',
        category: 'output',
        title: 'Node Execution Output',
        content: node.output,
      });
    }

    // 3. Console Logs
    if (node.logs && node.logs.length > 0) {
      items.push({
        id: 'console-logs',
        category: 'logs',
        title: `Console Logs (${node.logs.length} entries)`,
        content: node.logs,
      });
    }

    // 4. Execution Error
    if (node.error) {
      items.push({
        id: 'execution-error',
        category: 'error',
        title: 'Execution Error',
        content: node.error,
      });
    }

    return items;
  }, [node, edges, upstreamInput, lastManualInput, allNodes]);

  // Filter logs by category and search query
  const filteredLogItems = useMemo(() => {
    return logItems.filter((item) => {
      if (filterCategory !== 'all' && item.category !== filterCategory) {
        return false;
      }
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase();
      const titleMatch = item.title.toLowerCase().includes(q);
      const contentStr = Array.isArray(item.content)
        ? item.content.join(' ')
        : typeof item.content === 'object'
        ? JSON.stringify(item.content)
        : String(item.content);
      const contentMatch = contentStr.toLowerCase().includes(q);

      return titleMatch || contentMatch;
    });
  }, [logItems, filterCategory, searchQuery]);

  const handleCopy = (id: string, content: any) => {
    const text = contentToText(content);
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Detect JSON in any value: objects/arrays are JSON; strings are parsed if they
  // look like JSON (`{...}` or `[...]`). Returns a flat result with an isJson flag.
  const tryParseJson = (value: any): { isJson: boolean; data: any; raw: string } => {
    if (value === null || value === undefined) return { isJson: false, data: undefined, raw: String(value) };
    if (typeof value === 'object') return { isJson: true, data: value, raw: '' };
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return { isJson: false, data: undefined, raw: value };
      if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
        return { isJson: false, data: undefined, raw: value };
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          return { isJson: true, data: parsed, raw: value };
        }
        return { isJson: false, data: undefined, raw: value };
      } catch {
        return { isJson: false, data: undefined, raw: value };
      }
    }
    return { isJson: false, data: undefined, raw: String(value) };
  };

  // Recursively walk an object/array and parse any property values that are
  // stringified JSON (e.g. upstream node outputs serialized into text). This makes
  // nested JSON strings readable when pretty-printed instead of staying escaped.
  const deepParseJson = (value: any): any => {
    if (Array.isArray(value)) {
      return value.map((item) => deepParseJson(item));
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const key of Object.keys(value)) {
        out[key] = deepParseJson(value[key]);
      }
      return out;
    }
    if (typeof value === 'string') {
      const result = tryParseJson(value);
      if (result.isJson) return deepParseJson(result.data);
    }
    return value;
  };

  // Recursively render a value. Objects are shown property-by-property so that
  // plain-text string values (e.g. upstream node outputs like Markdown) keep their
  // newlines and quotes intact instead of being escaped inside a JSON string.
  // JSON-looking strings are still pretty-printed as JSON.
  const renderValue = (value: any): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span className="text-slate-500">{String(value)}</span>;
    }
    if (typeof value === 'string') {
      const result = tryParseJson(value);
      if (result.isJson) {
        return (
          <pre className="whitespace-pre-wrap break-words text-slate-900 m-0">
            {JSON.stringify(deepParseJson(result.data), null, 2)}
          </pre>
        );
      }
      // Plain text: preserve newlines and quotes as-is, no escaping
      return <div className="whitespace-pre-wrap break-words text-slate-800">{value}</div>;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-slate-500">[]</span>;
      return (
        <div>
          {value.map((item, i) => (
            <div key={i} className="mb-1.5 last:mb-0">
              {renderValue(item)}
            </div>
          ))}
        </div>
      );
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) return <span className="text-slate-500">{'{}'}</span>;
      return (
        <div>
          {entries.map(([key, val]) => (
            <div key={key} className="mb-2 last:mb-0">
              <div className="text-slate-500 font-semibold text-[10px] uppercase tracking-wide mb-0.5">
                {key}
              </div>
              <div className="ml-2 border-l border-hairline-soft pl-2">
                {renderValue(val)}
              </div>
            </div>
          ))}
        </div>
      );
    }
    // number / boolean / bigint
    return <span className="text-slate-800">{String(value)}</span>;
  };

  // Render content with automatic JSON detection. Arrays render each element on its
  // own line. Objects and strings are delegated to renderValue so plain-text values
  // keep their formatting while JSON values are pretty-printed.
  const renderContent = (content: any) => {
    if (Array.isArray(content)) {
      if (content.length === 0) {
        return <div className="whitespace-pre-wrap break-words text-slate-800">(empty array)</div>;
      }
      return (
        <div>
          {content.map((line, idx) => (
            <div key={idx} className="mb-1.5 last:mb-0">
              {renderValue(line)}
            </div>
          ))}
        </div>
      );
    }
    return renderValue(content);
  };

  // Plain-text representation used by the copy button. Mirrors renderValue: objects
  // are emitted property-by-property with plain-text values kept as-is and JSON
  // values pretty-printed, so copied content stays readable and unescaped.
  const valueToText = (value: any): string => {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') {
      const result = tryParseJson(value);
      if (result.isJson) {
        return JSON.stringify(deepParseJson(result.data), null, 2);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => valueToText(item)).join('\n');
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      return entries
        .map(([key, val]) => {
          const inner = valueToText(val);
          const indented = inner
            .split('\n')
            .map((l, i) => (i === 0 ? l : `  ${l}`))
            .join('\n');
          return `${key}:\n${indented}`;
        })
        .join('\n\n');
    }
    return String(value);
  };

  const contentToText = (content: any): string => {
    if (Array.isArray(content)) {
      return content.map((item) => valueToText(item)).join('\n');
    }
    return valueToText(content);
  };

  // One-line preview shown in the collapsed header so users still get context.
  const getPreviewText = (content: any): string => {
    if (Array.isArray(content)) {
      if (content.length === 0) return '(empty)';
      const first = content[0];
      const str = typeof first === 'string' ? first : JSON.stringify(first);
      const suffix = content.length > 1 ? ` (+${content.length - 1} more)` : '';
      return (str.length > 60 ? str.slice(0, 60) + '…' : str) + suffix;
    }
    if (typeof content === 'object' && content !== null) {
      const keys = Object.keys(content);
      if (keys.length === 0) return '{}';
      return `{${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}`;
    }
    const str = String(content);
    return str.length > 80 ? str.slice(0, 80) + '…' : str;
  };

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        title="Expand details panel"
        className="absolute right-4 top-3.5 z-30 p-2 rounded-lg bg-surface-card hover:bg-surface-canvas-soft text-ink border border-hairline shadow-md transition-all cursor-pointer flex items-center gap-1.5 text-xs font-medium"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    );
  }

  return (
    <>
      <div className="w-full sm:w-[420px] md:w-1/3 sm:min-w-[380px] max-w-[600px] h-1/2 sm:h-full bg-surface-canvas border-t sm:border-t-0 sm:border-l border-hairline-strong flex flex-col shrink-0 z-30 fixed inset-x-0 bottom-0 sm:relative sm:inset-auto">
        {/* Collapse Button (Outside panel top-left for desktop, top for mobile) */}
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse details panel"
          className="absolute -top-10 right-4 sm:top-3.5 sm:-left-10 sm:right-auto z-30 p-2 rounded-lg bg-surface-card hover:bg-surface-canvas-soft text-ink border border-hairline shadow-sm transition-all cursor-pointer"
        >
          <ChevronRight className="w-4 h-4 rotate-90 sm:rotate-0" />
        </button>

        {/* Header */}
        <div className="h-14 px-4 border-b border-hairline-soft flex items-center justify-between shrink-0 bg-surface-canvas/90 backdrop-blur-md gap-3">
          {node && activeModule ? (
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => !readOnly && setShowIconModal(true)}
                disabled={readOnly}
                title={readOnly ? undefined : 'Click to change node icon and color'}
                className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 bg-white transition-transform ${
                  !readOnly ? 'hover:scale-105 cursor-pointer' : ''
                }`}
                style={{
                  borderColor: node.color ? `${node.color}40` : '#e6e5e0',
                  color: node.color || activeModule.color,
                }}
              >
                {renderLucideIcon(node.icon, 'w-4 h-4')}
              </button>

              <div className="min-w-0 flex-1">
                <div className="group/title flex min-w-0 items-center gap-1">
                  <input
                    type="text"
                    value={nodeTitleDraft}
                    readOnly={readOnly}
                    aria-label="Node name"
                    title={readOnly ? node.title : 'Edit node name'}
                    onFocus={() => { titleBeforeEditRef.current = node.title; }}
                    onChange={(event) => {
                      const title = event.target.value;
                      setNodeTitleDraft(title);
                      if (!readOnly && title.trim() && title !== node.title) {
                        onUpdateNode({ ...node, title });
                      }
                    }}
                    onBlur={(event) => commitNodeTitle(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') {
                        const title = titleBeforeEditRef.current;
                        setNodeTitleDraft(title);
                        if (title && title !== node.title) onUpdateNode({ ...node, title });
                        event.currentTarget.value = title;
                        event.currentTarget.blur();
                      }
                    }}
                    className={`min-w-0 flex-1 rounded px-1 py-0.5 text-xs font-semibold text-ink outline-none ${
                      readOnly
                        ? 'cursor-default bg-transparent'
                        : 'bg-transparent  focus:ring-1 focus:ring-hairline-strong'
                    }`}
                  />
                  {!readOnly && <PencilLine className="h-3 w-3 shrink-0 text-muted opacity-0 transition-opacity group-hover/title:opacity-100" />}
                </div>
                <div className="text-[10px] text-muted flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {activeModule.badge && (
                    <span className="font-mono bg-surface-canvas-soft px-1.5 py-0.5 rounded border border-hairline-soft leading-none">
                      {activeModule.badge}
                    </span>
                  )}

                  {node.status === 'success' ? (
                    <span className="status-badge status-badge-success py-0 px-1.5 text-[10px]">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      Success
                    </span>
                  ) : node.status === 'error' ? (
                    <span className="status-badge status-badge-error py-0 px-1.5 text-[10px]">
                      <AlertCircle className="w-2.5 h-2.5" />
                      Failed
                    </span>
                  ) : (
                    <span className="status-badge status-badge-neutral py-0 px-1.5 text-[10px]">Not run</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium text-xs text-ink">Node Details & Logs</span>
            </div>
          )}

          {node && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowNodeDocModal(true)}
                title="View NODE.md documentation"
                aria-label="View node documentation"
                className="grid h-7 w-7 place-items-center rounded-lg border border-hairline bg-surface-card text-muted transition-colors hover:bg-surface-canvas-soft hover:text-ink cursor-pointer"
              >
                <CircleHelp className="h-3.5 w-3.5" />
              </button>

              {node.executionTime !== undefined && (
                <span className="text-[11px] text-muted font-mono flex items-center gap-1">
                  <Clock className="w-3 h-3 text-muted" />
                  {(node.executionTime / 1000).toFixed(1)}s
                </span>
              )}

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onRunSingleNode(node.id)}
                  className="btn-pill border text-xs flex items-center gap-1.5 active:scale-97 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Run
                </button>
              )}
            </div>
          )}
        </div>

        {!node || !activeModule ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center text-center space-y-3 text-muted">
            <div className="p-4 rounded-lg bg-surface-card border border-hairline text-muted">
              <Terminal className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-ink">No node selected</h4>
              <p className="text-xs text-muted mt-1 max-w-xs">
                Click a node on the canvas to view its latest execution logs, input/output, and custom UI.
              </p>
            </div>
          </div>
        ) : (
          <>
          {/* Custom Panel Link Line */}
          {hasCustomPanel && (
              <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b border-hairline-soft">
                <label className="flex items-center gap-1.5 text-xs hover:text-ink cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={openPanelOnClickNode}
                    onChange={toggleOpenPanelOnClickNode}
                    className="accent-black rounded cursor-pointer"
                  />
                  <span>Open panel on click node</span>
                </label>

                <button
                  type="button"
                  onClick={() => setShowFullPanelModal(true)}
                  className="text-xs border border-gray-300 rounded-md px-2 py-1 flex items-center gap-1 font-medium cursor-pointer"
                >
                  <span>open custom node panel</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            )}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-2 flex flex-col space-y-4 min-h-0">
            {/* Unified Log Stream Section Header & Filters */}
            <div className="space-y-1 shrink-0">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-ink flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-primary" />
                  Unified execution logs & data flow
                </div>
                <span className="text-[10px] text-muted font-mono">{logItems.length} records</span>
              </div>

              {/* Filter category pills */}
              <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'input', label: 'Input' },
                    { id: 'output', label: 'Output' },
                    { id: 'logs', label: 'Console' },
                    { id: 'error', label: 'Error' },
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setFilterCategory(cat.id)}
                    className={`px-2.5 py-1 rounded-pill text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      filterCategory === cat.id
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-card text-muted hover:text-ink border border-hairline'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Search filter input */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search logs or data..."
                  className="input-pill pl-8 py-1 text-xs w-full"
                />
              </div>
            </div>

            {/* Log Stream List — accordion: expanding one block fills the height and collapses the others */}
            <div className="flex-1 flex flex-col gap-1.5 min-h-0">
              {filteredLogItems.length === 0 ? (
                <div className="p-6 text-center text-muted text-xs bg-surface-card rounded-xl border border-hairline">
                  <Filter className="w-5 h-5 mx-auto mb-2 opacity-50" />
                  {logItems.length === 0 ? 'No execution logs or data' : 'No logs matching the filter criteria'}
                </div>
              ) : (
                filteredLogItems.map((item) => {
                  const isExpanded = expandedItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg bg-surface-card border border-hairline text-xs flex flex-col min-h-0 overflow-hidden transition-[flex-grow] ${
                        isExpanded ? 'flex-1 border-hairline-strong' : 'shrink-0'
                      }`}
                    >
                      {/* Clickable header — toggles expansion */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setExpandedItemId(isExpanded ? null : item.id);
                          }
                        }}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-surface-canvas-soft/60 transition-colors w-full text-left select-none"
                      >
                        <div className="flex items-center gap-1.5 font-medium text-ink min-w-0">
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-muted shrink-0" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-muted shrink-0" />
                          )}
                          {item.category === 'input' && <ArrowRight className="w-3 h-3 text-blue-500 shrink-0" />}
                          {item.category === 'output' && <FileText className="w-3 h-3 text-emerald-500 shrink-0" />}
                          {item.category === 'logs' && <Terminal className="w-3 h-3 text-amber-500 shrink-0" />}
                          {item.category === 'error' && <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />}
                          <span className="truncate text-[11px]">{item.title}</span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                          {!isExpanded && (
                            <span className="text-[10px] text-muted font-mono truncate max-w-[140px]">
                              {getPreviewText(item.content)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(item.id, item.content);
                            }}
                            className="text-[10px] text-muted hover:text-ink flex items-center gap-0.5 cursor-pointer shrink-0"
                          >
                            {copiedId === item.id ? (
                              <>
                                <Check className="w-3 h-3 text-semantic-success" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Content — only rendered when expanded; fills remaining height with internal scroll */}
                      {isExpanded && (
                        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar border-t border-hairline-soft bg-surface-canvas-soft p-2.5 text-ink font-mono text-[11px] leading-relaxed">
                          {renderContent(item.content)}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          </>
        )}
      </div>

      {!readOnly && node && (
        <IconPickerModal
          isOpen={showIconModal}
          onClose={() => setShowIconModal(false)}
          currentIcon={node.icon}
          currentColor={node.color || getModule(node.type).color}
          onSave={handleSaveIconAndColor}
        />
      )}

      {/* Fullscreen Custom Node Panel Modal */}
      {showFullPanelModal && node && activeModule && createPortal(
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/50">
          <header className="flex items-center justify-between gap-3 px-4 py-1.5 md:px-6">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="shrink-0"
                style={{ color: node.color || activeModule.color }}
              >
                {renderLucideIcon(node.icon, 'w-4 h-4')}
              </span>
              <h2 className="truncate text-sm font-semibold text-white">{node.title}</h2>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowFullPanelModal(false)}
                title="Close panel (Esc)"
                className="grid place-items-center w-7 h-7 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4 md:p-8">
            <ErrorBoundary label="NodeRenderPageModal">
              {activeModule.CustomView ? (
                <div className="w-full max-w-4xl bg-surface-canvas p-6 rounded-2xl border border-hairline shadow-2xl text-ink">
                  <activeModule.CustomView
                    node={node}
                    allNodes={allNodes}
                    edges={edges}
                    onUpdateNode={onUpdateNode}
                    onRunSingleNode={onRunSingleNode}
                    workflowId={workflowId}
                    runId={runId}
                    readOnly={readOnly}
                  />
                </div>
              ) : activeModule.OutputView ? (
                <div className="w-full max-w-4xl bg-surface-canvas p-6 rounded-2xl border border-hairline shadow-2xl text-ink">
                  <activeModule.OutputView
                    node={node}
                    allNodes={allNodes}
                    edges={edges}
                    onUpdateNode={onUpdateNode}
                    onRunSingleNode={onRunSingleNode}
                    workflowId={workflowId}
                    runId={runId}
                    readOnly={readOnly}
                  />
                </div>
              ) : activeModule.RenderPage ? (
                <div className="w-full h-full flex flex-col">
                  <activeModule.RenderPage />
                </div>
              ) : (
                <div className="text-white/60 text-sm">No custom panel view defined for this node.</div>
              )}
            </ErrorBoundary>
          </div>
        </div>,
        document.body
      )}

      {showNodeDocModal && node && (
        <NodeDocModal
          nodeTitle={node.title}
          nodeType={node.type}
          markdown={nodeDoc ?? ''}
          onClose={() => setShowNodeDocModal(false)}
        />
      )}
    </>
  );
};
