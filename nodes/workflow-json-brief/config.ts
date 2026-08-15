export interface WorkflowJsonBriefConfig {
  /** Workspace-root-relative path to the workflow definition. */
  sourceWorkflowPath: string;
  targetLanguage: string;
  targetAudience: string;
  explanationFocus: string;
  includeNodeDocs: boolean;
  includeNodeConfig: boolean;
  maxWorkflowBytes: number;
  maxNodeDocChars: number;
  maxConfigValueChars: number;
}

export const DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG: WorkflowJsonBriefConfig = {
  sourceWorkflowPath: '',
  targetLanguage: 'English',
  targetAudience: 'People familiar with automation and AI tools who have not seen this workflow implementation',
  explanationFocus: 'Why the workflow exists, what each node does, how data moves along the edges, key configuration, final output, and warning or failure boundaries',
  includeNodeDocs: true,
  includeNodeConfig: true,
  maxWorkflowBytes: 1_000_000,
  maxNodeDocChars: 2_500,
  maxConfigValueChars: 600,
};
