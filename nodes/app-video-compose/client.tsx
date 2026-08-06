import type { NodeModule } from '@/App/types.node-module';

export const appVideoComposeModule: NodeModule = {
  type: 'app-video-compose',
  label: 'Compose Video Project',
  menuLabel: 'Compose Video Project',
  description: 'Join the deterministic video project and generated Demo UI assets.',
  icon: 'Combine',
  color: '#2563eb',
  menuOrder: 32,
  createConfig: () => ({}),
};

export default appVideoComposeModule;
