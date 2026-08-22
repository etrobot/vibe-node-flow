import { getEnv } from "./env";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/** Return Telegram configuration, or null when Telegram notifications are disabled. */
export function getTelegramConfig(): TelegramConfig | null {
  const env = getEnv();
  const botToken = env.TELEGRAM_BOT_TOKEN.trim();
  const chatId = env.TELEGRAM_CHAT_ID.trim();
  if (!botToken && !chatId) return null;
  if (!botToken || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured together");
  }
  return { botToken, chatId };
}

/**
 * Send a plain-text Telegram message. The caller decides whether a send error
 * should affect the original operation; scheduled runs use this as best effort.
 */
export async function sendTelegramMessage(
  text: string,
  config: TelegramConfig | null = getTelegramConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!config) return false;

  const response = await fetchImpl(
    `https://api.telegram.org/bot${config.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Telegram API returned ${response.status}${details ? `: ${details}` : ""}`);
  }
  return true;
}
