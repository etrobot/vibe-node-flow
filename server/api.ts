import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import type { WorkflowItem } from "../App/types";
import * as storage from "./storage";
import * as store from "./db";
import { callLLM } from "./llm";
import { nodeOutputToText, normalizeNodeInput } from "../lib/node-io";
import { getMaxFlowNodes } from "./env";
import {
  listNodePluginDiagnostics,
  listNodePlugins,
  nodePluginHasCapability,
  nodePluginScript,
} from "./plugins";
import { workflowAssetDir, workflowRunAssetsDir } from "./paths";
import { getWorkflowRunJob, startSingleNodeRun, startWorkflowRun } from "./run-service";
import { openVideoRenderTerminal, VIDEO_RENDER_SCRIPT } from "./video-render-terminal";
import { saveWorkflowSchedule } from "./schedule-config";
import {
  getWorkflowScheduleStatus,
  removeWorkflowSchedule,
  syncWorkflowSchedule,
} from "./scheduler";

// Wrap an async handler so thrown errors become 400/500 JSON instead of hanging.
const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error("API error:", err);
      if (!res.headersSent) {
        res.status(400).json({ error: err?.message || String(err) });
      } else {
        res.end();
      }
    });
  };

export function registerApiRoutes(app: Express): void {
  store.getDb(); // initialize schema eagerly

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Public, non-secret runtime policy derived from server environment.
  app.get("/api/runtime-config", (_req, res) => {
    res.json({ maxFlowNodes: getMaxFlowNodes() });
  });

  // Runtime plugin status for installation checks and troubleshooting.
  app.get("/api/node-plugins", (_req, res) => {
    res.json({ plugins: listNodePlugins(), diagnostics: listNodePluginDiagnostics() });
  });

  // Generated narration and video are immutable per asset id. Express sendFile
  // handles byte-range requests, which keeps seeking in the HTML audio and
  // video elements smooth.
  app.get(
    "/api/workflows/:id/assets/:assetId/*",
    wrap(async (req, res) => {
      const relative = String(req.params[0] || "");
      const parts = relative.split("/");
      // Demo pages are nested under demo/, while older narration/render assets
      // remain available at the run root. Reject traversal before resolving.
      if (
        !relative || relative.startsWith("/") || relative.includes("\\")
        || parts.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(part))
      ) {
        return res.status(404).json({ error: "Workflow asset not found" });
      }
      const root = workflowAssetDir(String(req.params.id || ""), String(req.params.assetId || ""));
      const filePath = path.resolve(root, relative);
      if (filePath !== path.resolve(root) && !filePath.startsWith(`${path.resolve(root)}${path.sep}`)) {
        return res.status(404).json({ error: "Workflow asset not found" });
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return res.status(404).json({ error: "Workflow asset not found" });
      }
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.sendFile(filePath);
    }),
  );

  // ---- Workflows CRUD -------------------------------------------------------

  app.get(
    "/api/workflows",
    wrap(async (_req, res) => {
      res.json(storage.listWorkflows());
    })
  );

  app.get(
    "/api/workflows/:id",
    wrap(async (req, res) => {
      const wf = storage.getWorkflow(req.params.id);
      if (!wf) return res.status(404).json({ error: "Workflow not found" });
      res.json(wf);
    })
  );

  app.post(
    "/api/workflows",
    wrap(async (req, res) => {
      const { name, description = "" } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: "Missing workflow name" });
      }
      const wf = storage.createWorkflow(String(name), String(description));
      res.status(201).json(wf);
    })
  );

  // Full save (graph + node bodies) from the canvas.
  app.put(
    "/api/workflows/:id",
    wrap(async (req, res) => {
      const item = req.body as WorkflowItem;
      if (!item || !Array.isArray(item.nodes) || !Array.isArray(item.edges)) {
        return res.status(400).json({ error: "Invalid workflow data" });
      }
      item.id = req.params.id; // trust the URL, not the body
      const saved = storage.saveWorkflow(item);
      res.json(saved);
    })
  );

  // Lightweight metadata edit (name/description/icon/color) from list or editor.
  app.patch(
    "/api/workflows/:id",
    wrap(async (req, res) => {
      const { name, description, icon, color } = req.body || {};
      const wf = storage.updateWorkflowMeta(
        req.params.id,
        name === undefined ? undefined : String(name),
        description === undefined ? undefined : String(description),
        icon === undefined ? undefined : String(icon),
        color === undefined ? undefined : String(color)
      );
      if (!wf) return res.status(404).json({ error: "Workflow not found" });
      res.json(wf);
    })
  );

  app.delete(
    "/api/workflows/:id",
    wrap(async (req, res) => {
      await removeWorkflowSchedule(req.params.id);
      const ok = storage.deleteWorkflow(req.params.id);
      if (!ok) return res.status(404).json({ error: "Workflow not found" });
      res.json({ success: true });
    })
  );

  app.post(
    "/api/workflows/:id/duplicate",
    wrap(async (req, res) => {
      const wf = storage.duplicateWorkflow(req.params.id);
      if (!wf) return res.status(404).json({ error: "Workflow not found" });
      res.status(201).json(wf);
    })
  );

  // ---- Server-owned schedules ---------------------------------------------

  app.get(
    "/api/workflows/:id/schedule",
    wrap(async (req, res) => {
      if (!storage.getWorkflow(req.params.id)) {
        return res.status(404).json({ error: "Workflow not found" });
      }
      res.json(getWorkflowScheduleStatus(req.params.id));
    }),
  );

  app.put(
    "/api/workflows/:id/schedule",
    wrap(async (req, res) => {
      if (!storage.getWorkflow(req.params.id)) {
        return res.status(404).json({ error: "Workflow not found" });
      }
      saveWorkflowSchedule(req.params.id, req.body || {});
      await syncWorkflowSchedule(req.params.id);
      res.json(getWorkflowScheduleStatus(req.params.id));
    }),
  );

  // ---- Execution ------------------------------------------------------------

  // Full run — starts an independent Worker job, then subscribes this HTTP
  // response to its event stream. Closing the browser only unsubscribes it;
  // the Worker continues and persists the run.
  app.post(
    "/api/workflows/:id/run",
    wrap(async (req, res) => {
      const job = startWorkflowRun(req.params.id, "full");

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const unsubscribe = job.subscribe((event) => {
        if (!res.destroyed && !res.writableEnded) {
          res.write(JSON.stringify(event) + "\n");
        }
      });
      let closed = false;
      const connectionClosed = new Promise<"closed">((resolve) => {
        res.once("close", () => {
          closed = true;
          resolve("closed");
        });
      });
      await Promise.race([job.done.then(() => "done" as const), connectionClosed]);
      unsubscribe();
      if (!closed && !res.writableEnded) res.end();
    })
  );

  // Fire-and-forget entry for backend callers. The cron scheduler uses the
  // same run service directly and never goes through a browser connection.
  app.post(
    "/api/workflows/:id/run/background",
    wrap(async (req, res) => {
      const job = startWorkflowRun(req.params.id, "full");
      res.status(202).json({ runId: job.id, status: "running" });
    }),
  );

  // Single node test — runs one node with caller-supplied upstream context.
  app.post(
    "/api/workflows/:id/nodes/:nodeId/run",
    wrap(async (req, res) => {
      const input = normalizeNodeInput(req.body?.input);
      const nodeOutputs = Object.fromEntries(
        Object.entries(req.body?.nodeOutputs || {}).map(([key, value]) => [
          key,
          nodeOutputToText(value),
        ]),
      );

      const job = startSingleNodeRun(req.params.id, req.params.nodeId, input, nodeOutputs);
      // Return the id immediately so another request can stop a long-running
      // node through /api/runs/:id/stop while its Worker is still active.
      res.status(202).json({ runId: job.id, status: job.status });
    })
  );

  // ---- Run history ----------------------------------------------------------

  app.get(
    "/api/runs/:id/status",
    wrap(async (req, res) => {
      const active = getWorkflowRunJob(req.params.id);
      if (active) {
        return res.json({
          runId: active.id,
          status: active.status,
          startedAt: active.startedAt,
          finishedAt: active.finishedAt,
        });
      }
      const run = store.getRun(req.params.id);
      if (!run) return res.status(404).json({ error: "Run record not found" });
      return res.json({
        runId: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      });
    }),
  );

  app.post(
    "/api/runs/:id/stop",
    wrap(async (req, res) => {
      const job = getWorkflowRunJob(req.params.id);
      if (!job) {
        const run = store.getRun(req.params.id);
        if (!run) return res.status(404).json({ error: "Run record not found" });
        return res.json({ runId: run.id, stopped: false, status: run.status });
      }
      const stopped = job.stop();
      return res.json({ runId: job.id, stopped, status: job.status });
    }),
  );

  app.get(
    "/api/runs",
    wrap(async (req, res) => {
      const workflowId = req.query.workflowId
        ? String(req.query.workflowId)
        : undefined;
      const status = req.query.status
        ? String(req.query.status)
        : undefined;
      const startAt = req.query.startAt
        ? String(req.query.startAt)
        : undefined;
      const endAt = req.query.endAt
        ? String(req.query.endAt)
        : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      res.json(store.listRuns(workflowId, status, startAt, endAt, limit, offset));
    })
  );

  app.get(
    "/api/runs/:id",
    wrap(async (req, res) => {
      const run = store.getRun(req.params.id);
      if (!run) return res.status(404).json({ error: "Run record not found" });
      res.json(run);
    })
  );

  // A stable, controls-free spec endpoint used by the headless MP4 renderer
  // and by the standalone video-render page.
  app.get(
    "/api/video/spec/:runId",
    wrap(async (req, res) => {
      const run = store.getRun(req.params.runId);
      if (!run) return res.status(404).json({ error: "Run record not found" });
      const videoNode = [...run.nodes]
        .reverse()
        .find((node) => nodePluginHasCapability(node.nodeType, "video-spec") && node.output);
      const fallback = [...run.nodes].reverse().find((node) => node.output);
      const output = videoNode?.output ?? fallback?.output;
      if (!output) return res.status(404).json({ error: "No video spec available for this run" });
      res.setHeader("Cache-Control", "no-store");
      res.json(output);
    })
  );

  app.post(
    "/api/runs/:id/render-video/terminal",
    wrap(async (req, res) => {
      const run = store.getRun(req.params.id);
      if (!run) return res.status(404).json({ error: "Run record not found" });
      const videoNode = [...run.nodes]
        .reverse()
        .find((node) => nodePluginHasCapability(node.nodeType, "video-spec") && node.output);
      if (!videoNode) {
        return res.status(400).json({ error: "This run has no completed video-preview output" });
      }
      const baseUrl = (process.env.STUDIO_URL?.trim()
        || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, "");
      const outputPath = path.join(workflowRunAssetsDir(run.workflowId, run.id), "video.mp4");
      // The node ships the renderer; the host only launches it. Nothing here
      // names a node type or a package.json script.
      const scriptPath = nodePluginScript(videoNode.nodeType, VIDEO_RENDER_SCRIPT);
      if (!scriptPath) {
        return res.status(400).json({
          error: `Node ${videoNode.nodeType} does not ship ${VIDEO_RENDER_SCRIPT}, so there is nothing to run`,
        });
      }
      await openVideoRenderTerminal({
        projectRoot: process.cwd(),
        scriptPath,
        runId: run.id,
        baseUrl,
        outputPath,
      });
      res.status(202).json({
        started: true,
        runId: run.id,
        outputPath,
        assetUrl: `/api/workflows/${encodeURIComponent(run.workflowId)}/assets/${encodeURIComponent(run.id)}/video.mp4`,
      });
    }),
  );

  app.delete(
    "/api/runs/:id",
    wrap(async (req, res) => {
      const ok = store.deleteRun(req.params.id);
      res.json({ success: ok });
    })
  );

  // ---- Server-side LLM proxy (credentials and model always come from env) ----

  app.post(
    "/api/llm/completion",
    wrap(async (req, res) => {
      try {
        const result = await callLLM(req.body || {});
        res.json({
          content: result.content,
          raw: result.raw,
          choices: result.raw?.choices || [
            { message: { role: "assistant", content: result.content } },
          ],
          model: result.model,
        });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || String(err) });
      }
    })
  );

}
