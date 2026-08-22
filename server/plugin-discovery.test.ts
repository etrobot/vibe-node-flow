import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultLabelFromDirName, discoverNodePlugins } from "./plugin-discovery.ts";

const tempDirs: string[] = [];

function makeTempProject(nodes: Record<string, Record<string, string>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "genno-node-discovery-"));
  tempDirs.push(root);
  const nodesRoot = path.join(root, "nodes");
  fs.mkdirSync(nodesRoot, { recursive: true });
  for (const [dirName, files] of Object.entries(nodes)) {
    const dir = path.join(nodesRoot, dirName);
    fs.mkdirSync(dir, { recursive: true });
    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, fileName), content);
    }
  }
  return root;
}

test.after(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverNodePlugins loads server-only nodes without client.tsx", () => {
  const root = makeTempProject({
    "demo-node": {
      "node.json": JSON.stringify({ type: "demo.node", label: "Demo Node" }),
      "server.ts": "export default { type: 'demo.node', execute() {} };",
    },
  });

  const { plugins, diagnostics } = discoverNodePlugins(root);
  assert.deepEqual(diagnostics, []);
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0]?.clientPath, null);
  assert.equal(plugins[0]?.manifest.label, "Demo Node");
  assert.equal(plugins[0]?.type, "demo.node");
});

test("discoverNodePlugins still loads nodes that ship client.tsx", () => {
  const root = makeTempProject({
    "with-client": {
      "node.json": JSON.stringify({ type: "with.client" }),
      "server.ts": "export default { type: 'with.client', execute() {} };",
      "client.tsx": "export default { type: 'with.client', label: 'With Client' };",
    },
  });

  const { plugins } = discoverNodePlugins(root);
  assert.equal(plugins.length, 1);
  assert.match(plugins[0]?.clientPath ?? "", /client\.tsx$/);
});

test("discoverNodePlugins skips directories missing server.ts", () => {
  const root = makeTempProject({
    "broken-node": {
      "node.json": JSON.stringify({ type: "broken.node" }),
    },
  });

  const { plugins, diagnostics } = discoverNodePlugins(root);
  assert.equal(plugins.length, 0);
  assert.ok(diagnostics.some((item) => item.dirName === "broken-node"));
});

test("defaultLabelFromDirName title-cases hyphenated folder names", () => {
  assert.equal(defaultLabelFromDirName("fish-audio-narration"), "Fish Audio Narration");
});
