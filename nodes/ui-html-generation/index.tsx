import type { NodeModule } from '@/App/types.node-module';
import { DEFAULT_UI_HTML_GENERATION_CONFIG } from './config';

export const uiHtmlGenerationModule: NodeModule = {
  type: 'ui-html-generation',
  label: 'UI HTML Generation',
  menuLabel: 'UI HTML Generation',
  description: 'Generate one validated self-contained HTML document per Demo UI target.',
  icon: 'PanelsTopLeft',
  color: '#0891b2',
  menuOrder: 30,
  createConfig: () => ({ ...DEFAULT_UI_HTML_GENERATION_CONFIG }),
};

export default uiHtmlGenerationModule;
