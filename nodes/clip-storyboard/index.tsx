import type { NodeModule } from '@/App/types.node-module';
import { DEFAULT_CLIP_STORYBOARD_CONFIG } from './config';

export const clipStoryboardModule: NodeModule = {
  type: 'clip-storyboard',
  label: 'Clip Storyboard',
  menuLabel: 'Clip Storyboard',
  description: 'Turn a verified brief into renderer-ready clip JSON with plain narration, validated against the builder contract.',
  icon: 'Clapperboard',
  color: '#c2410c',
  badge: 'Storyboard',
  menuOrder: 20,
  createConfig: () => ({ ...DEFAULT_CLIP_STORYBOARD_CONFIG }),
};
