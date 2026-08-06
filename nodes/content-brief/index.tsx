import type { NodeModule } from '@/App/types.node-module';
import { DEFAULT_CONTENT_BRIEF_CONFIG } from './config';

export const contentBriefModule: NodeModule = {
  type: 'content-brief',
  label: 'Content Brief',
  menuLabel: 'Content Brief',
  description: 'Combine a verified editorial contract with optional upstream research before any model call.',
  icon: 'FileInput',
  color: '#0f766e',
  menuOrder: 5,
  createConfig: () => ({ ...DEFAULT_CONTENT_BRIEF_CONFIG }),
};
