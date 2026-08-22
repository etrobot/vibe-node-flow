import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, X } from 'lucide-react';
import mermaid from 'mermaid';

interface NodeDocModalProps {
  nodeTitle: string;
  nodeType: string;
  markdown: string;
  onClose: () => void;
}

let mermaidReady = false;

function ensureMermaid() {
  if (mermaidReady) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
  });
  mermaidReady = true;
}

function MermaidBlock({ source }: { source: string }) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const chart = source.trim();
    if (!chart) return undefined;

    const renderChart = async () => {
      try {
        ensureMermaid();
        const renderId = `node-doc-mermaid-${reactId.replace(/:/g, '')}`;
        const { svg } = await mermaid.render(renderId, chart);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        setError(null);
      } catch (err) {
        console.error('[NodeDocModal] mermaid render failed:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void renderChart();
    return () => {
      cancelled = true;
    };
  }, [reactId, source]);

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-md border border-hairline-soft bg-surface-canvas-soft p-2 font-mono text-[11px] leading-relaxed text-ink">
        {source}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto rounded-md border border-hairline-soft bg-surface-canvas-soft p-2 [&_svg]:mx-auto"
    />
  );
}

function CodeBlock({ language, source }: { language: string; source: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-hairline-soft bg-surface-canvas-soft">
      {language ? (
        <div className="border-b border-hairline-soft px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted">
          {language}
        </div>
      ) : null}
      <pre className="overflow-x-auto p-2 font-mono text-[11px] leading-relaxed text-ink">
        <code>{source}</code>
      </pre>
    </div>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="rounded border border-hairline-soft bg-surface-canvas-soft px-1 py-0.5 font-mono text-[11px] text-ink"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

export function SimpleMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(' ').trim();
    if (text) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="text-sm leading-relaxed text-ink">
          {renderInlineMarkdown(text)}
        </p>,
      );
    }
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
        {listItems.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();

    const fenceMatch = trimmed.match(/^```(\w+)?$/);
    if (fenceMatch) {
      flushList();
      flushParagraph();
      const language = fenceMatch[1] ?? '';
      const codeLines: string[] = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !lines[lineIndex].trim().startsWith('```')) {
        codeLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      const code = codeLines.join('\n');
      if (language === 'mermaid') {
        blocks.push(<MermaidBlock key={`mermaid-${blocks.length}`} source={code} />);
      } else {
        blocks.push(<CodeBlock key={`code-${blocks.length}`} language={language} source={code} />);
      }
      continue;
    }

    if (!trimmed) {
      flushList();
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushList();
      flushParagraph();
      blocks.push(
        <h3 key={`h3-${blocks.length}`} className="text-sm font-semibold text-ink">
          {trimmed.slice(4)}
        </h3>,
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      flushParagraph();
      blocks.push(
        <h2 key={`h2-${blocks.length}`} className="text-base font-semibold text-ink">
          {trimmed.slice(3)}
        </h2>,
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      flushParagraph();
      blocks.push(
        <h1 key={`h1-${blocks.length}`} className="text-lg font-semibold text-ink">
          {trimmed.slice(2)}
        </h1>,
      );
      continue;
    }

    if (trimmed.startsWith('- ')) {
      flushParagraph();
      listItems.push(trimmed.slice(2));
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushList();
  flushParagraph();

  return <div className="space-y-3">{blocks}</div>;
}

export const NodeDocModal: React.FC<NodeDocModalProps> = ({
  nodeTitle,
  nodeType,
  markdown,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${nodeTitle} documentation`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(80vh,720px)] w-full max-w-2xl flex-col overflow-hidden card-panel">
        <div className="panel-header shrink-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded-md border border-hairline bg-surface-canvas p-2.5 text-primary-text">
              <BookOpen className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-ink">{nodeTitle}</h3>
              <p className="truncate font-mono text-[11px] text-muted">NODE.md · {nodeType}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost" aria-label="Close documentation">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-5">
          <SimpleMarkdown source={markdown} />
        </div>
      </div>
    </div>,
    document.body,
  );
};
