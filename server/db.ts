import fs from "node:fs";
import Database from "better-sqlite3";
import type {
  RunRecord,
  RunSummary,
  RunNodeRecord,
  NodeType,
  NodeStatus,
  RunTrigger,
} from "../App/types";
import { ensureDataDirs, DB_PATH, workflowRunAssetsDir } from "./paths";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDirs();
  const database = new Database(DB_PATH);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id            TEXT PRIMARY KEY,
      workflow_id   TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      trigger       TEXT NOT NULL,
      status        TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      finished_at   TEXT NOT NULL,
      duration_ms   INTEGER NOT NULL,
      workflow_snapshot TEXT
    );
    CREATE TABLE IF NOT EXISTS run_nodes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id         TEXT NOT NULL,
      seq            INTEGER NOT NULL,
      node_id        TEXT NOT NULL,
      node_title     TEXT NOT NULL,
      node_type      TEXT NOT NULL,
      status         TEXT NOT NULL,
      output         TEXT,
      logs           TEXT,
      error          TEXT,
      execution_time INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs(workflow_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_nodes_run ON run_nodes(run_id, seq);
  `);

  // Existing databases predate the read-only execution snapshot. SQLite's
  // CREATE TABLE IF NOT EXISTS does not add new columns, so migrate in place.
  const runColumns = database.prepare(`PRAGMA table_info(runs)`).all() as Array<{
    name: string;
  }>;
  if (!runColumns.some((column) => column.name === "workflow_snapshot")) {
    database.exec(`ALTER TABLE runs ADD COLUMN workflow_snapshot TEXT`);
  }
  db = database;
  return database;
}

const serialize = (v: any): string => {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
};

// Best-effort parse: run_nodes.output is stored as raw string or JSON.
const parseOutput = (raw: string | null): any => {
  if (raw === null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

export function insertRun(record: RunRecord): void {
  const database = getDb();
  const insertRunStmt = database.prepare(`
    INSERT INTO runs (id, workflow_id, workflow_name, trigger, status, started_at, finished_at, duration_ms, workflow_snapshot)
    VALUES (@id, @workflowId, @workflowName, @trigger, @status, @startedAt, @finishedAt, @durationMs, @workflowSnapshot)
  `);
  const insertNodeStmt = database.prepare(`
    INSERT INTO run_nodes (run_id, seq, node_id, node_title, node_type, status, output, logs, error, execution_time)
    VALUES (@runId, @seq, @nodeId, @nodeTitle, @nodeType, @status, @output, @logs, @error, @executionTime)
  `);

  const tx = database.transaction((rec: RunRecord) => {
    insertRunStmt.run({
      id: rec.id,
      workflowId: rec.workflowId,
      workflowName: rec.workflowName,
      trigger: rec.trigger,
      status: rec.status,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt,
      durationMs: rec.durationMs,
      workflowSnapshot: rec.workflowSnapshot
        ? JSON.stringify(rec.workflowSnapshot)
        : "",
    });
    rec.nodes.forEach((n, seq) => {
      insertNodeStmt.run({
        runId: rec.id,
        seq,
        nodeId: n.nodeId,
        nodeTitle: n.nodeTitle,
        nodeType: n.nodeType,
        status: n.status,
        output: serialize(n.output),
        logs: n.logs && n.logs.length ? JSON.stringify(n.logs) : "",
        error: n.error ?? "",
        executionTime: n.executionTime ?? 0,
      });
    });
  });
  tx(record);
}

export function listRuns(
  workflowId?: string,
  status?: string,
  limit = 20,
  offset = 0
): { runs: RunSummary[]; total: number } {
  const database = getDb();

  const conditions: string[] = [];
  const params: any[] = [];
  if (workflowId) { conditions.push("r.workflow_id = ?"); params.push(workflowId); }
  if (status) { conditions.push("r.status = ?"); params.push(status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (database.prepare(`SELECT COUNT(*) AS cnt FROM runs r ${where}`).get(...params) as any).cnt;

  const rows = database
    .prepare(
      `SELECT r.*,
        (SELECT COUNT(*) FROM run_nodes n WHERE n.run_id = r.id) AS node_count
       FROM runs r ${where} ORDER BY r.started_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const runs = (rows as any[]).map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    workflowName: r.workflow_name,
    trigger: r.trigger as RunTrigger,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    nodeCount: r.node_count,
  }));

  return { runs, total };
}

export function getRun(id: string): RunRecord | null {
  const database = getDb();
  const r = database.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as any;
  if (!r) return null;
  const nodes = database
    .prepare(`SELECT * FROM run_nodes WHERE run_id = ? ORDER BY seq ASC`)
    .all(id) as any[];

  const nodeRecords: RunNodeRecord[] = nodes.map((n) => ({
    nodeId: n.node_id,
    nodeTitle: n.node_title,
    nodeType: n.node_type as NodeType,
    status: n.status as NodeStatus,
    output: parseOutput(n.output),
    logs: n.logs ? (JSON.parse(n.logs) as string[]) : [],
    error: n.error || null,
    executionTime: n.execution_time,
  }));

  return {
    id: r.id,
    workflowId: r.workflow_id,
    workflowName: r.workflow_name,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    nodes: nodeRecords,
    workflowSnapshot: r.workflow_snapshot
      ? (parseOutput(r.workflow_snapshot) as RunRecord["workflowSnapshot"])
      : undefined,
  };
}

export function deleteRun(id: string): boolean {
  const database = getDb();
  const run = database.prepare(`SELECT workflow_id FROM runs WHERE id = ?`).get(id) as
    | { workflow_id: string }
    | undefined;
  const info = database.prepare(`DELETE FROM runs WHERE id = ?`).run(id);
  database.prepare(`DELETE FROM run_nodes WHERE run_id = ?`).run(id);
  if (run) {
    fs.rmSync(workflowRunAssetsDir(run.workflow_id, id), { recursive: true, force: true });
  }
  return info.changes > 0;
}
