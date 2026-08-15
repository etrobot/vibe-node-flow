import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findCrossNodeImports, formatCrossNodeImportViolation } from "./node-import-policy.ts";

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genno-node-imports-"));
}

function write(projectRoot: string, relative: string, contents: string): void {
  const file = path.join(projectRoot, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

test("findCrossNodeImports detects direct and nested cross-node imports", () => {
  const projectRoot = makeProject();
  write(projectRoot, "nodes/a/server.ts", `import { helper } from './local.ts'; export { helper } from '../b/helper.ts';`);
  write(projectRoot, "nodes/a/local.ts", `export { value } from '../b/helper.ts';`);
  write(projectRoot, "nodes/b/helper.ts", "export const value = 1;");

  const violations = findCrossNodeImports(projectRoot);
  assert.equal(violations.length, 2);
  assert.match(formatCrossNodeImportViolation(violations[0]), /another node/);
  assert.ok(violations.every((violation) => (
    violation.fromNode === "a" && violation.toNode === "b" && violation.targetKind === "node"
  )));
});

test("findCrossNodeImports allows imports within one node and external packages", () => {
  const projectRoot = makeProject();
  write(projectRoot, "nodes/a/server.ts", `import fs from 'node:fs'; import { local } from './local'; export { local };`);
  write(projectRoot, "nodes/a/local.ts", "export const local = true;");
  write(projectRoot, "nodes/b/helper.ts", "export const value = 1;");

  assert.deepEqual(findCrossNodeImports(projectRoot), []);
});

test("findCrossNodeImports also checks the project's @ alias", () => {
  const projectRoot = makeProject();
  write(projectRoot, "nodes/a/server.ts", "export { value } from '@/nodes/b/helper.ts';");
  write(projectRoot, "nodes/b/helper.ts", "export const value = 1;");

  const violations = findCrossNodeImports(projectRoot);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].specifier, "@/nodes/b/helper.ts");
});

test("findCrossNodeImports rejects imports into workflow code", () => {
  const projectRoot = makeProject();
  write(projectRoot, "nodes/a/server.ts", "export { value } from '../../workflows/demo/helper.ts';");
  write(projectRoot, "workflows/demo/helper.ts", "export const value = 1;");

  const violations = findCrossNodeImports(projectRoot);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].targetKind, "workflow");
  assert.equal(violations[0].toNode, null);
  assert.match(formatCrossNodeImportViolation(violations[0]), /workflow code/);
});
