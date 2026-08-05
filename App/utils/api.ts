import {
  WorkflowItem,
  RunSummary,
  RunRecord,
  RunEvent,
  SingleNodeRunRecord,
  WorkflowSchedule,
  WorkflowScheduleStatus,
} from '../types';
import type { NodeTextInput } from '../../lib/node-io';

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      /* non-json error */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export const api = {
  // ---- Workflows ----
  listWorkflows: () =>
    fetch('/api/workflows').then((r) => parse<WorkflowItem[]>(r)),

  getWorkflow: (id: string) =>
    fetch(`/api/workflows/${id}`).then((r) => parse<WorkflowItem>(r)),

  createWorkflow: (name: string, description: string) =>
    fetch('/api/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name, description }),
    }).then((r) => parse<WorkflowItem>(r)),

  saveWorkflow: (wf: WorkflowItem) =>
    fetch(`/api/workflows/${wf.id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(wf),
    }).then((r) => parse<WorkflowItem>(r)),

  updateMeta: (
    id: string,
    name: string,
    description: string,
    icon?: string,
    color?: string
  ) =>
    fetch(`/api/workflows/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name, description, icon, color }),
    }).then((r) => parse<WorkflowItem>(r)),

  deleteWorkflow: (id: string) =>
    fetch(`/api/workflows/${id}`, { method: 'DELETE' }).then((r) =>
      parse<{ success: boolean }>(r)
    ),

  duplicateWorkflow: (id: string) =>
    fetch(`/api/workflows/${id}/duplicate`, { method: 'POST' }).then((r) =>
      parse<WorkflowItem>(r)
    ),

  getWorkflowSchedule: (id: string) =>
    fetch(`/api/workflows/${id}/schedule`).then((r) =>
      parse<WorkflowScheduleStatus>(r)
    ),

  saveWorkflowSchedule: (id: string, schedule: WorkflowSchedule) =>
    fetch(`/api/workflows/${id}/schedule`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(schedule),
    }).then((r) => parse<WorkflowScheduleStatus>(r)),

  // ---- Execution ----
  runSingleNode: (
    workflowId: string,
    nodeId: string,
    body: { input: NodeTextInput; nodeOutputs: Record<string, string> },
    onStarted?: (runId: string) => void,
  ): Promise<SingleNodeRunRecord> =>
    fetch(`/api/workflows/${workflowId}/nodes/${nodeId}/run`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }).then((r) => parse<{ runId: string; status: 'running' | 'success' | 'error' }>(r))
      .then(async ({ runId }) => {
        onStarted?.(runId);
        while (true) {
          const status = await fetch(`/api/runs/${encodeURIComponent(runId)}/status`)
            .then((r) => parse<{ status: 'running' | 'success' | 'error' }>(r));
          if (status.status !== 'running') break;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
        }
        const run = await api.getRun(runId);
        const record = run.nodes[0];
        if (!record) throw new Error('Single-node run returned no node record');
        return { ...record, runId };
      }),

  openVideoRenderTerminal: (runId: string) =>
    fetch(`/api/runs/${encodeURIComponent(runId)}/render-video/terminal`, {
      method: 'POST',
    }).then((r) => parse<{
      started: true;
      runId: string;
      outputPath: string;
      assetUrl: string;
    }>(r)),

  stopWorkflow: (runId: string) =>
    fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
    }).then((r) => parse<{
      runId: string;
      stopped: boolean;
      status: 'running' | 'success' | 'error';
    }>(r)),

  // Streaming full run. Invokes onEvent for every NDJSON event as it arrives.
  runWorkflow: async (
    workflowId: string,
    onEvent: (event: RunEvent) => void
  ): Promise<void> => {
    const res = await fetch(`/api/workflows/${workflowId}/run`, {
      method: 'POST',
    });
    if (!res.ok || !res.body) {
      let msg = `Run failed (${res.status})`;
      try {
        msg = (await res.json()).error || msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const emitLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        onEvent(JSON.parse(trimmed) as RunEvent);
      } catch {
        /* skip malformed line */
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        emitLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    }
    emitLine(buffer);
  },

  // ---- Run history ----
  listRuns: (workflowId?: string, offset = 0, limit = 20, status?: string) => {
    const params = new URLSearchParams();
    if (workflowId) params.set('workflowId', workflowId);
    if (status) params.set('status', status);
    params.set('offset', String(offset));
    params.set('limit', String(limit));
    return fetch(`/api/runs?${params.toString()}`).then((r) =>
      parse<{ runs: RunSummary[]; total: number }>(r).then((res) => {
        // Normalise: old server format returns array directly
        if (Array.isArray(res)) return { runs: res, total: res.length };
        return { runs: res.runs ?? [], total: res.total ?? 0 };
      })
    );
  },

  getRun: (id: string) => fetch(`/api/runs/${id}`).then((r) => parse<RunRecord>(r)),

  deleteRun: (id: string) =>
    fetch(`/api/runs/${id}`, { method: 'DELETE' }).then((r) =>
      parse<{ success: boolean }>(r)
    ),
};
