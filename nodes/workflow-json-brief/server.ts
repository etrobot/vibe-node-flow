import {
  NodeInputError,
  NodeValidationError,
  createNodeLogger,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import {
  WorkflowBriefInputError,
  WorkflowBriefValidationError,
  buildWorkflowExplanationBrief,
  loadWorkflowSourceFile,
  normalizeWorkflowJsonBriefConfig,
  workflowSourceFromManualJson,
  type WorkflowBriefSource,
} from './core.ts';
import type { WorkflowJsonBriefConfig } from './config.ts';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function looksLikeWorkflowPath(value: string): boolean {
  const text = clean(value);
  if (!text) return false;
  if (text.includes('\n')) return false;
  if (text.length > 500) return false;
  if (text.startsWith('#')) return false;
  return true;
}

function manualOverride(input: Record<string, string>): { path?: string; rawJson?: string } | null {
  const values = Object.entries(input || {})
    .map(([id, value]) => ({ id, value: clean(value) }))
    .filter((item) => Boolean(item.value));
  if (!values.length) return null;
  if (values.length > 1) {
    throw new NodeInputError(
      'Workflow JSON Brief accepts at most one manual/upstream override; received '
      + values.map((item) => item.id).join(', ') + '.',
    );
  }
  const value = values[0].value;
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        return { rawJson: value };
      }
      const configuredPath = clean(parsed?.sourceWorkflowPath || parsed?.workflowPath || parsed?.path);
      if (configuredPath && looksLikeWorkflowPath(configuredPath)) return { path: configuredPath };
    } catch {
      return { rawJson: value };
    }
  }
  if (!looksLikeWorkflowPath(value)) return null;
  return { path: value };
}

export async function executeWorkflowJsonBrief(
  {
  node,
  input,
  workflowDefinitionDir,
  onLog,
  onResourceAccess,
  }: NodePluginContext,
): Promise<NodePluginResult> {
  const config = normalizeWorkflowJsonBriefConfig(node.config);
  const log = createNodeLogger(onLog);
  onResourceAccess?.({ kind: 'filesystem', operation: 'read', detail: 'workflow definition and NODE.md sources' });
  // This node is deliberately deterministic. Opening copy and its visual beats
  // are generated together with the complete storyboard downstream.
  let source: WorkflowBriefSource;
  try {
    const override = manualOverride(input);
    if (override?.rawJson) {
      if (Buffer.byteLength(override.rawJson) > config.maxWorkflowBytes) {
        throw new WorkflowBriefInputError(
          'Manual workflow JSON exceeds the ' + config.maxWorkflowBytes + '-byte limit.',
        );
      }
      source = workflowSourceFromManualJson(override.rawJson);
      log.push('Using raw workflow JSON from manual/upstream input.');
    } else {
      const sourcePath = override?.path || config.sourceWorkflowPath;
      source = await loadWorkflowSourceFile(process.cwd(), sourcePath, config.maxWorkflowBytes);
      log.push(
        'Loaded workflow definition ' + source.sourceLabel + ' (' + source.sourceBytes + ' bytes).',
      );
    }

    const built = await buildWorkflowExplanationBrief({
      projectRoot: process.cwd(),
      workflowDefinitionDir,
      config,
      source,
    });
    // Downstream LLMs receive only the compact graph/evidence contract. The
    // full deterministic markdown remains available through core APIs/tests,
    // but is not serialized into the workflow edge output.
    const output = built.compactBrief;
    log.push('Opening narration is generated inside the complete storyboard JSON by clip-storyboard.');
    log.push(
      'Validated workflow graph: ' + source.document.nodes.length + ' nodes, '
        + source.document.edges.length + ' edges, ' + built.analysis.waves.length + ' execution waves.',
      'Node documentation: ' + built.documentedTypes.length + ' type(s) found, '
        + built.missingDocumentedTypes.length + ' missing.',
      'Mermaid materials: ' + built.mermaidMaterials.length + ' diagram(s) extracted from selected NODE.md files.',
      'Redacted ' + built.redactedConfigValues + ' sensitive configuration value(s).',
      'Produced a ' + output.length + '-character workflow explainer brief for '
        + config.targetLanguage + ' / ' + config.targetDurationSeconds + 's.',
    );
    return { output, logs: log.logs };
  } catch (error) {
    if (error instanceof NodeInputError || error instanceof NodeValidationError) throw error;
    if (error instanceof WorkflowBriefInputError) throw new NodeInputError(error.message);
    if (error instanceof WorkflowBriefValidationError) throw new NodeValidationError(error.message);
    throw error;
  }
}

async function execute(context: NodePluginContext): Promise<NodePluginResult> {
  return executeWorkflowJsonBrief(context);
}

export default {
  type: 'workflow-json-brief',
  capabilities: ['filesystem-read', 'graph-validation', 'evidence-brief', 'llm'],
  execute,
};
