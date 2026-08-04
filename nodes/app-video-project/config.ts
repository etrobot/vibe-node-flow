export interface AppVideoProjectConfig {
  /** Write a description.md summarizing the storyboard for human reviewers. */
  writeDescription: boolean;
}

export const DEFAULT_APP_VIDEO_PROJECT_CONFIG: AppVideoProjectConfig = {
  writeDescription: true,
};
