/// <reference types="vite/client" />
declare module 'virtual:vibenodeflow-node-modules' {
  import type { NodeModule } from './types.node-module';
  interface ExternalNodeModule {
    dirName: string;
    expectedType: string;
    module: NodeModule;
    nodeDoc: string | null;
  }
  const modules: ExternalNodeModule[];
  export default modules;
}
