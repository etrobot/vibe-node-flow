import type { NodeModule } from '@/App/types.node-module';
import { DEFAULT_APP_VIDEO_DEMO_UI_CONFIG } from './config';

export const appVideoDemoUiModule: NodeModule = {
  type: 'app-video-demo-ui',
  label: 'Generate Demo UI HTML',
  menuLabel: 'Generate Demo UI HTML',
  description: 'Generate deterministic, self-contained product UI HTML for storyboard demo shots.',
  icon: 'PanelsTopLeft',
  color: '#0891b2',
  menuOrder: 31,
  createConfig: () => ({ ...DEFAULT_APP_VIDEO_DEMO_UI_CONFIG }),
};

export default appVideoDemoUiModule;
