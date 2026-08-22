import assert from "node:assert/strict";
import test from "node:test";
import { sendTelegramMessage, type TelegramConfig } from "./telegram";

const config: TelegramConfig = { botToken: "bot-token", chatId: "chat-id" };

test("skips Telegram when notifications are disabled", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error("fetch should not be called");
  };

  assert.equal(await sendTelegramMessage("ignored", null, fetchImpl), false);
  assert.equal(called, false);
});

test("sends a Telegram message to the configured chat", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  assert.equal(await sendTelegramMessage("cron failed", config, fetchImpl), true);
  assert.equal(request?.url, "https://api.telegram.org/botbot-token/sendMessage");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    chat_id: "chat-id",
    text: "cron failed",
    disable_web_page_preview: true,
  });
});

test("surfaces Telegram API failures", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ ok: false, description: "chat not found" }), {
      status: 400,
    });

  await assert.rejects(
    sendTelegramMessage("cron failed", config, fetchImpl),
    /Telegram API returned 400:.*chat not found/,
  );
});
