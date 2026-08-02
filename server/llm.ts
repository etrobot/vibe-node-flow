import { requireEnv } from "./env.ts";

export interface LLMMessage {
  role: string;
  content: string;
}

export interface LLMRequest {
  temperature?: number;
  messages?: LLMMessage[];
  prompt?: string;
  /** Provider/network attempts for transient 408/429/5xx failures. Defaults to 3. */
  maxAttempts?: number;
}

export interface LLMResult {
  content: string;
  model: string;
  attempts: number;
  raw?: any;
}

const TRANSIENT_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function retryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, seconds * 1000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.min(10_000, Math.max(0, at - Date.now()));
  }
  return Math.min(4_000, 600 * 2 ** Math.max(0, attempt - 1));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shared LLM invocation used by both the /api/llm/completion proxy and node
// extensions. Throws Error on failure.
export async function callLLM(req: LLMRequest): Promise<LLMResult> {
  const env = requireEnv(["BASE_URL", "API_KEY", "LLM_MODEL"]);
  const { messages, prompt, temperature = 0.7 } = req;
  const maxAttempts = Math.max(1, Math.min(6, Number(req.maxAttempts) || 3));
  const baseUrl = env.BASE_URL.trim().replace(/\/$/, "");
  const apiKey = env.API_KEY.trim();
  const model = env.LLM_MODEL.trim();

  let targetUrl = baseUrl;
  if (!targetUrl.endsWith("/chat/completions")) {
    targetUrl += targetUrl.endsWith("/") ? "chat/completions" : "/chat/completions";
  }

  const formattedMessages = messages || [{ role: "user", content: prompt || "Hello" }];
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  let lastError = "unknown provider error";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: formattedMessages,
          temperature: Number(temperature),
        }),
        signal: AbortSignal.timeout(300_000),
      });

      if (response.ok) {
        const data: any = await response.json();
        let content = "";
        if (data.choices && data.choices[0] && data.choices[0].message) {
          content = data.choices[0].message.content || "";
        } else if (typeof data === "string") {
          content = data;
        } else {
          content = JSON.stringify(data);
        }
        return { content, model: data.model || model, attempts: attempt, raw: data };
      }

      const errText = await response.text();
      lastError = `HTTP ${response.status}: ${errText}`;
      if (!TRANSIENT_HTTP_STATUS.has(response.status) || attempt >= maxAttempts) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts) break;
    }
    await wait(retryDelayMs(response, attempt));
  }
  throw new Error(`LLM API request failed after ${maxAttempts} attempt(s): ${lastError}`);
}
