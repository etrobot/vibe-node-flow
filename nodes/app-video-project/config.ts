export interface AppVideoProjectConfig {
  /**
   * Builder workspace that receives a copy of the project, relative to the
   * server data directory. Blank writes only into the run's asset directory.
   */
  builderProjectsDir: string;
  /** Replace an existing project folder of the same slug instead of failing. */
  overwrite: boolean;
  /** Write a description.md summarizing the storyboard for human reviewers. */
  writeDescription: boolean;
}

export const DEFAULT_APP_VIDEO_PROJECT_CONFIG: AppVideoProjectConfig = {
  builderProjectsDir: 'idea-to-app-builder/projects',
  overwrite: true,
  writeDescription: true,
};
