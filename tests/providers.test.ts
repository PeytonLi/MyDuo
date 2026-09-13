import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { elevenLabsVoices } from "../src/lib/server/env";
import { parseModelSuggestion } from "../src/lib/server/suggestions";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for provider checks`);
  return value;
};

test("configured DeepSeek model returns validated JSON", { timeout: 30_000 }, async () => {
  const client = new OpenAI({
    apiKey: required("DEEPSEEK_API_KEY"),
    baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    timeout: 20_000,
    maxRetries: 1,
  });
  const response = await client.chat.completions.create({
    model: required("DEEPSEEK_MODEL"),
    messages: [{ role: "user", content: 'Return exactly this JSON object: {"text":"Provider check passed.","evidenceIds":[]}' }],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    temperature: 0,
    max_tokens: 80,
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { thinking: { type: "disabled" } });
  const parsed = parseModelSuggestion(response.choices[0]?.message.content || "", new Set());
  assert.equal(parsed.text, "Provider check passed.");
});

test("configured ElevenLabs voice returns playable audio", { timeout: 30_000 }, async () => {
  const voiceId = elevenLabsVoices()[0].id;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128&enable_logging=false`, {
    method: "POST",
    headers: { "xi-api-key": required("ELEVENLABS_API_KEY"), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: "MyDuo provider check.", model_id: process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5" }),
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /audio/);
  assert.ok((await response.arrayBuffer()).byteLength > 1_000);
});

test("configured Recall region accepts the workspace key", { timeout: 30_000 }, async () => {
  const region = required("RECALL_REGION");
  const response = await fetch(`https://${region}.recall.ai/api/v1/bot/?limit=1`, {
    headers: { Authorization: required("RECALL_API_KEY"), Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /json/);
});
