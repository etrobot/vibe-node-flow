/// <reference types="vite/client" />
declare module 'virtual:vibenodeflow-node-modules' {
  import type { NodeModule } from './types.node-module';
  interface ExternalNodeModule {
    dirName: string;
    expectedType: string;
    module: NodeModule;
  }
  const modules: ExternalNodeModule[];
  export default modules;
}
