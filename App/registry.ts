import type { FlowNode, NodeType } from './types';
import type { NodeModule } from './types.node-module';
import externalNodeModules from 'virtual:genno-node-modules';
import React from 'react';

// The single source of truth for node types. Add a module here and it appears in
// the header add-node menu, renders on the canvas, and drives its inspector —
// no per-type branches elsewhere.
const missingNodeModule: NodeModule = {
  type: '__missing__',
  label: 'Unknown',
  menuLabel: 'Uninstalled node',
  description: 'This node extension is not installed or failed to load.',
  icon: 'Puzzle',
  color: '#64748b',
  badge: 'Missing node',
  availableInMenu: false,
  createConfig: () => ({}),
};

function nodeModuleFromManifest(manifest: {
  type: string;
  label?: string;
  menuLabel?: string;
  description?: string;
  icon?: string;
  color?: string;
  menuOrder?: number;
  availableInMenu?: boolean;
}): NodeModule {
  return {
    type: manifest.type,
    label: manifest.label ?? manifest.type,
    menuLabel: manifest.menuLabel,
    description: manifest.description,
    icon: manifest.icon,
    color: manifest.color,
    menuOrder: manifest.menuOrder,
    availableInMenu: manifest.availableInMenu,
    createConfig: () => ({}),
  };
}

const pluginModules: NodeModule[] = [];
const claimedTypes = new Set<NodeType>();

for (const external of externalNodeModules) {
  const clientModule = external?.module;
  const manifest = external?.manifest;
  const hasClientModule = clientModule
    && typeof clientModule === 'object'
    && typeof clientModule.type === 'string'
    && typeof clientModule.label === 'string';

  const resolved = hasClientModule
    ? clientModule
    : (manifest?.type ? nodeModuleFromManifest(manifest) : null);

  if (!resolved) {
    console.error(`[node-plugin] ${external?.dirName || 'unknown'}: no client.tsx and invalid node.json manifest`);
    continue;
  }
  if (resolved.type !== external.expectedType) {
    const source = hasClientModule ? 'client.tsx' : 'node.json';
    console.error(`[node-plugin] nodes/${external.dirName} ${source} type "${resolved.type}" does not match node.json "${external.expectedType}"`);
    continue;
  }
  if (claimedTypes.has(resolved.type)) {
    console.error(`[node-plugin] Node type ${resolved.type} is duplicate, ignored nodes/${external.dirName}`);
    continue;
  }

  // Fill default fallback values for optional metadata
  const normalizedModule: NodeModule = {
    ...resolved,
    menuLabel: resolved.menuLabel ?? resolved.label,
    description: resolved.description ?? '',
    icon: resolved.icon ?? 'Puzzle',
    color: resolved.color ?? '#64748b',
    badge: resolved.badge,
    createConfig: resolved.createConfig ?? (() => ({})),
  };

  claimedTypes.add(resolved.type);
  pluginModules.push(normalizedModule);
}

pluginModules.sort((left, right) => (left.menuOrder ?? 1000) - (right.menuOrder ?? 1000));

export const NODE_MODULES: NodeModule[] = pluginModules;

export const ADDABLE_NODE_MODULES = NODE_MODULES.filter(
  (module) => module.availableInMenu !== false,
);

const BY_TYPE = new Map<NodeType, NodeModule>(NODE_MODULES.map((module) => [module.type, module]));

const DOC_BY_TYPE = new Map<NodeType, string>();
for (const external of externalNodeModules) {
  const doc = external?.nodeDoc;
  const type = external?.manifest?.type ?? external?.module?.type;
  if (typeof type === 'string' && typeof doc === 'string' && doc.trim()) {
    DOC_BY_TYPE.set(type, doc);
  }
}

export function getModule(type: NodeType): NodeModule {
  return BY_TYPE.get(type) ?? { ...missingNodeModule, type };
}

export function getNodeDoc(type: NodeType): string | null {
  return DOC_BY_TYPE.get(type) ?? null;
}

/** CustomView / RenderPage always count. OutputView only counts when the node has output. */
export function nodeHasCustomPanel(node: FlowNode | null | undefined): boolean {
  if (!node) return false;
  const nodeModule = getModule(node.type);
  if (nodeModule.CustomView || nodeModule.RenderPage) return true;
  if (!nodeModule.OutputView) return false;
  return node.output != null && node.output !== '';
}

export function getRenderPage(): React.FC | null {
  return NODE_MODULES.find((module) => module.RenderPage)?.RenderPage ?? null;
}
