import type { NodeModule } from '@/App/types.node-module';
import { DEFAULT_APP_VIDEO_PROJECT_CONFIG } from './config';

export const appVideoProjectModule: NodeModule = {
  type: 'app-video-project',
  label: 'App Video Project',
  menuLabel: 'App Video Project',
  description: 'Write a validated storyboard into the current run assets: chapters.json plus chapter/chapter-N.json.',
  icon: 'FolderTree',
  color: '#0369a1',
  menuOrder: 30,
  createConfig: () => ({ ...DEFAULT_APP_VIDEO_PROJECT_CONFIG }),
};
