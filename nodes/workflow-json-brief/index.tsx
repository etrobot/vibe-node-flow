import React, { useMemo } from 'react';
import type { FlowNode } from '@/App/types';
import type { NodeModule, NodeModuleEditorProps } from '@/App/types.node-module';
import { DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG } from './config';

function updateConfig(
  node: FlowNode,
  patch: Record<string, unknown>,
  onUpdateNode: NodeModuleEditorProps['onUpdateNode'],
): void {
  onUpdateNode({ ...node, config: { ...(node.config || {}), ...patch } });
}

const WorkflowJsonBriefPanel: React.FC<NodeModuleEditorProps> = ({ node, onUpdateNode, readOnly }) => {
  const config = { ...DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG, ...(node.config || {}) };
  const outputSummary = useMemo(() => {
    const output = String(node.output || '');
    if (!output) return null;
    const source = output.match(/^- Source: (.+)$/m)?.[1] || '';
    const counts = output.match(/^- Scale: (.+)$/m)?.[1] || '';
    return { source, counts, chars: output.length };
  }, [node.output]);

  return (
    <div className="flex flex-col gap-5 text-sm">
      <div>
        <h3 className="text-base font-semibold text-ink">Workflow JSON brief</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Read one workflow definition, validate its DAG, and emit an evidence-grounded brief for a workflow explainer video.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink">Workflow JSON path</span>
        <input
          disabled={readOnly}
          value={String(config.sourceWorkflowPath || '')}
          onChange={(event) => updateConfig(node, { sourceWorkflowPath: event.target.value }, onUpdateNode)}
          placeholder="workflows/example/workflow.json"
          className="input-pill w-full text-xs font-mono"
        />
        <span className="text-[11px] leading-relaxed text-muted">
          Relative paths resolve from the project root and must stay inside it. A single-node manual run may override this with a path or raw workflow JSON.
        </span>
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink">Narration language</span>
          <input
            disabled={readOnly}
            value={String(config.targetLanguage || '')}
            onChange={(event) => updateConfig(node, { targetLanguage: event.target.value }, onUpdateNode)}
            className="input-pill w-full text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink">Target duration (seconds)</span>
          <input
            type="number"
            min={30}
            max={900}
            disabled={readOnly}
            value={Number(config.targetDurationSeconds || 90)}
            onChange={(event) => updateConfig(node, { targetDurationSeconds: Number(event.target.value) }, onUpdateNode)}
            className="input-pill w-full text-xs"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink">Audience</span>
        <textarea
          disabled={readOnly}
          value={String(config.targetAudience || '')}
          onChange={(event) => updateConfig(node, { targetAudience: event.target.value }, onUpdateNode)}
          rows={2}
          className="input-pill w-full resize-y py-3 text-xs"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink">Explanation focus</span>
        <textarea
          disabled={readOnly}
          value={String(config.explanationFocus || '')}
          onChange={(event) => updateConfig(node, { explanationFocus: event.target.value }, onUpdateNode)}
          rows={3}
          className="input-pill w-full resize-y py-3 text-xs"
        />
      </label>

      <div className="flex flex-wrap gap-4 text-xs text-ink">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={Boolean(config.includeNodeDocs)}
            onChange={(event) => updateConfig(node, { includeNodeDocs: event.target.checked }, onUpdateNode)}
            className="accent-primary"
          />
          Include NODE.md evidence
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={Boolean(config.includeNodeConfig)}
            onChange={(event) => updateConfig(node, { includeNodeConfig: event.target.checked }, onUpdateNode)}
            className="accent-primary"
          />
          Include redacted config
        </label>
      </div>

      {outputSummary && (
        <div className="rounded-xl border border-hairline bg-surface-card p-4 text-xs">
          <div className="font-medium text-ink">Latest brief</div>
          {outputSummary.source && <div className="mt-2 break-all text-muted">{outputSummary.source}</div>}
          {outputSummary.counts && <div className="mt-1 text-muted">{outputSummary.counts}</div>}
          <div className="mt-1 font-mono text-muted">{outputSummary.chars.toLocaleString()} chars</div>
        </div>
      )}
    </div>
  );
};

export const workflowJsonBriefModule: NodeModule = {
  type: 'workflow-json-brief',
  label: 'Workflow JSON Brief',
  menuLabel: 'Workflow JSON Brief',
  description: 'Validate a workflow JSON file and turn its graph, configuration, and node docs into an explainer-video brief.',
  icon: 'Workflow',
  color: '#2563eb',
  menuOrder: 4,
  createConfig: () => ({ ...DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG }),
  CustomView: WorkflowJsonBriefPanel,
};

export default workflowJsonBriefModule;
