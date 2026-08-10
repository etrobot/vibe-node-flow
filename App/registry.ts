import type { NodeType } from './types';
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

const pluginModules: NodeModule[] = [];
const claimedTypes = new Set<NodeType>();

for (const external of externalNodeModules) {
  const module = external?.module;
  const valid = module
    && typeof module === 'object'
    && typeof module.type === 'string'
    && typeof module.label === 'string';

  if (!valid) {
    console.error(`[node-plugin] ${external?.dirName || 'unknown'} client.tsx is not a valid NodeModule`);
    continue;
  }
  if (module.type !== external.expectedType) {
    console.error(`[node-plugin] nodes/${external.dirName} client.tsx type "${module.type}" does not match node.json "${external.expectedType}"`);
    continue;
  }
  if (claimedTypes.has(module.type)) {
    console.error(`[node-plugin] Node type ${module.type} is duplicate, ignored nodes/${external.dirName}`);
    continue;
  }

  // Fill default fallback values for optional metadata
  const normalizedModule: NodeModule = {
    ...module,
    menuLabel: module.menuLabel ?? module.label,
    description: module.description ?? '',
    icon: module.icon ?? 'Puzzle',
    color: module.color ?? '#64748b',
    badge: module.badge,
    createConfig: module.createConfig ?? (() => ({})),
  };

  claimedTypes.add(module.type);
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
  const type = external?.module?.type;
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

export function getRenderPage(): React.FC | null {
  return NODE_MODULES.find((module) => module.RenderPage)?.RenderPage ?? null;
}
