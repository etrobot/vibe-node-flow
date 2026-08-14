import type { NodeModule } from '@/App/types.node-module';
import { DEFAULT_MERMAID_EN_HTML_CONFIG } from './config';

export const mermaidEnHtmlModule: NodeModule = {
  type: 'mermaid-en-html',
  label: 'Mermaid English HTML',
  menuLabel: 'Mermaid English HTML',
  description: 'Extract verified NODE.md Mermaid diagrams and render offline English HTML.',
  icon: 'GitBranch',
  color: '#0891b2',
  menuOrder: 31,
  createConfig: () => ({ ...DEFAULT_MERMAID_EN_HTML_CONFIG }),
};

export default mermaidEnHtmlModule;
