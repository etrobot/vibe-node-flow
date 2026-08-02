export interface ContentBriefConfig {
  topic: string;
  audience: string;
  objective: string;
  centralThesis: string;
  targetLanguage: string;
  targetDurationSeconds: number;
  sourceNotes: string;
  factualBoundaries: string;
  requiredPoints: string;
  forbiddenClaims: string;
}

export const DEFAULT_CONTENT_BRIEF_CONFIG: ContentBriefConfig = {
  topic: '',
  audience: '',
  objective: '',
  centralThesis: '',
  targetLanguage: 'English',
  targetDurationSeconds: 150,
  sourceNotes: '',
  factualBoundaries: '',
  requiredPoints: '',
  forbiddenClaims: '',
};
