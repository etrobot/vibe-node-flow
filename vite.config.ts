import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { discoverNodePlugins } from './server/plugin-discovery';

const VIRTUAL_ID = 'virtual:vibenodeflow-node-modules';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

function nodePluginVite() {
  return {
    name: 'vibenodeflow-node-plugins',
    resolveId(id: string) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return undefined;
      const discovered = discoverNodePlugins(__dirname);
      for (const diagnostic of discovered.diagnostics) {
        this.warn(`[node-plugin] ${diagnostic.dirName}: ${diagnostic.message}`);
      }
      const imports = discovered.plugins.map(
        (plugin, index) => `import * as p${index} from ${JSON.stringify(plugin.clientPath)};`,
      );
      const values = discovered.plugins.map((plugin, index) => `({
        dirName: ${JSON.stringify(plugin.dirName)},
        expectedType: ${JSON.stringify(plugin.type)},
        module: p${index}.default ?? p${index}
      })`);
      return `${imports.join('\n')}\nexport default [${values.join(', ')}];`;
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [nodePluginVite(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      // A linked/file: plugin may have its own development install of React.
      // Always bind hooks to the host application's singleton runtime.
      dedupe: ['react', 'react-dom'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // Workflow saves are runtime persistence from the editor. Watching them
        // causes a full-page reload that destroys the in-memory canvas route.
        ignored: ['**/data/**', '**/workflows/**'],
      },
    },
  };
});
