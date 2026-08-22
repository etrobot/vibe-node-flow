import fs from 'node:fs';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import { discoverNodePlugins } from './server/plugin-discovery';

const VIRTUAL_ID = 'virtual:genno-node-modules';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

function nodePluginVite() {
  return {
    name: 'genno-node-plugins',
    resolveId(id: string) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return undefined;
      const discovered = discoverNodePlugins(__dirname);
      for (const diagnostic of discovered.diagnostics) {
        this.warn(`[node-plugin] ${diagnostic.dirName}: ${diagnostic.message}`);
      }
      const imports = discovered.plugins.map((plugin, index) => (
        plugin.clientPath
          ? `import * as p${index} from ${JSON.stringify(plugin.clientPath)};`
          : `const p${index} = { default: null };`
      ));
      const values = discovered.plugins.map((plugin, index) => {
        const docPath = path.join(plugin.dir, 'NODE.md');
        let nodeDoc: string | null = null;
        if (fs.existsSync(docPath)) {
          nodeDoc = fs.readFileSync(docPath, 'utf8');
        }
        return `({
        dirName: ${JSON.stringify(plugin.dirName)},
        expectedType: ${JSON.stringify(plugin.type)},
        module: p${index}.default ?? p${index} ?? null,
        manifest: ${JSON.stringify(plugin.manifest)},
        nodeDoc: ${JSON.stringify(nodeDoc)}
      })`;
      });
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
    // Vite otherwise crawls every HTML file below the project root. Runtime
    // browser profiles and the vendored Flow extension contain HTML entry
    // points with extension-only dynamic imports, so they must not be treated
    // as application dependency entries.
    optimizeDeps: {
      entries: ['index.html'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      // Keep HMR separate from the default workspace WebSocket port (24678).
      hmr: process.env.DISABLE_HMR !== 'true'
        ? { port: Number(process.env.VITE_HMR_PORT || 24679) }
        : false,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // Workflow saves are runtime persistence from the editor. Watching them
        // causes a full-page reload that destroys the in-memory canvas route.
        ignored: ['**/data/**', '**/workflows/**', '**/*.test.ts'],
      },
    },
  };
});
