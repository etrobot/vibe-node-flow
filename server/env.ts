/** Centralized, server-only model configuration. */

// Load .env on first import (idempotent — dotenv doesn't override existing
// process.env entries unless explicitly told to).
import "dotenv/config";

export interface EnvConfig {
  /** OpenAI-compatible base URL (e.g. https://api.openai.com/v1) */
  BASE_URL: string;
  /** API key for the LLM provider */
  API_KEY: string;
  /** Default LLM model name */
  LLM_MODEL: string;
  /** Vision / multimodal model name */
  VL_MODEL: string;
  /** Image generation model name */
  IMAGE_MODEL: string;
  /** Maximum nodes allowed in one workflow. Empty means the default (10). */
  MAX_FLOW_NODES: string;
  /** Telegram Bot API token used for scheduled-run failure notifications. */
  TELEGRAM_BOT_TOKEN: string;
  /** Telegram chat id that receives scheduled-run failure notifications. */
  TELEGRAM_CHAT_ID: string;
}

export type EnvKey = keyof EnvConfig;

/** Read all known env vars at once. */
export function getEnv(): EnvConfig {
  return {
    BASE_URL: process.env.BASE_URL || "",
    API_KEY: process.env.API_KEY || "",
    LLM_MODEL: process.env.LLM_MODEL || "",
    VL_MODEL: process.env.VL_MODEL || "",
    IMAGE_MODEL: process.env.IMAGE_MODEL || "",
    MAX_FLOW_NODES: process.env.MAX_FLOW_NODES || "",
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",
  };
}

export function getMaxFlowNodes(): number {
  const raw = getEnv().MAX_FLOW_NODES.trim();
  if (!raw) return 10;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("MAX_FLOW_NODES must be a positive integer");
  }
  return parsed;
}

/** Read required model settings exclusively from process.env / .env. */
export function requireEnv(keys: EnvKey[]): EnvConfig {
  const env = getEnv();
  const missing = keys.filter((key) => !env[key].trim());
  if (missing.length) {
    throw new Error(`.env missing required config: ${missing.join(", ")}`);
  }
  return env;
}
