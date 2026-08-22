/// <reference types="vite/client" />
declare module 'virtual:genno-node-modules' {
  import type { NodeModule } from './types.node-module';

  interface NodeManifestMeta {
    type: string;
    label?: string;
    menuLabel?: string;
    description?: string;
    icon?: string;
    color?: string;
    menuOrder?: number;
    availableInMenu?: boolean;
  }

  interface ExternalNodeModule {
    dirName: string;
    expectedType: string;
    module: NodeModule | null;
    manifest: NodeManifestMeta;
    nodeDoc: string | null;
  }
  const modules: ExternalNodeModule[];
  export default modules;
}
