import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { assistanceRequestSchema, approvalRequestSchema } from "../src/lib/contracts";
import { assertMutationOrigin, AuthError, consumeLoginAttempt, resetLoginAttempts } from "../src/lib/server/auth";
import { normalizeMeetingUrl, parseStatusEvent } from "../src/lib/server/meetings";
import { boundEvidence } from "../src/lib/server/memory";
import { verifyRecallWebhook } from "../src/lib/server/recall";
import { mediaTokenFrom, parseAcknowledgement } from "../src/lib/server/speech";
import { parseModelSuggestion } from "../src/lib/server/suggestions";
import { normalizeTranscriptEvent, parseTranscriptEvent } from "../src/lib/server/transcripts";

const id = "123e4567-e89b-42d3-a456-426614174000";

test("request contracts enforce limits and identifiers", () => {
  assert.equal(assistanceRequestSchema.parse({ mode: "clarify", selectedUtteranceIds: [], transcriptRevision: 0 }).mode, "clarify");
  assert.throws(() => assistanceRequestSchema.parse({ mode: "answer", selectedUtteranceIds: Array(11).fill(id), transcriptRevision: 0 }));
  assert.throws(() => approvalRequestSchema.parse({ suggestionId: id, version: 1, approvedText: "x".repeat(601), clientRequestId: id, reviewedTranscriptRevision: 0 }));
  assert.throws(() => parseAcknowledgement({ commandId: id, status: "cancelled" }));
});

test("Google Meet URLs are canonical and restricted", () => {
  assert.equal(normalizeMeetingUrl("https://meet.google.com/abc-defg-hij?authuser=1"), "https://meet.google.com/abc-defg-hij");
  for (const value of ["http://meet.google.com/abc-defg-hij", "https://evil.example/abc-defg-hij", "https://meet.google.com/not-a-code/extra"]) {
    assert.throws(() => normalizeMeetingUrl(value));
  }
});

test("Recall transcript parsing normalizes words and timing", () => {
  const event = parseTranscriptEvent({
    event: "transcript.data",
    data: {
      data: {
        words: [
          { text: " Hello ", start_timestamp: { relative: 1.2 }, end_timestamp: { relative: 1.4 } },
          { text: ",", start_timestamp: { relative: 1.4 }, end_timestamp: null },
          { text: "world", start_timestamp: { relative: 1.5 }, end_timestamp: { relative: 1.8 } },
        ],
        participant: { id: 7, name: " MyDuo " },
      },
      transcript: { id: "transcript-1" },
      bot: { id: "bot-1" },
    },
  });
  assert.deepEqual(normalizeTranscriptEvent(event), {
    providerBotId: "bot-1",
    providerTranscriptId: "transcript-1",
    speakerId: "7",
    speakerName: "MyDuo",
    text: "Hello, world",
    startMs: 1200,
    endMs: 1800,
    isBot: true,
  });
  assert.throws(() => parseTranscriptEvent({ event: "transcript.data", data: { data: { words: [] } } }));
});

test("Recall signatures reject tampering and stale delivery", () => {
  const body = '{"event":"bot.done"}';
  const secret = `whsec_${Buffer.from("regression-secret").toString("base64")}`;
  const timestamp = 2_000_000_000;
  const webhookId = "delivery-1";
  const signature = createHmac("sha256", Buffer.from("regression-secret"))
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest("base64");
  const headers = new Headers({
    "webhook-id": webhookId,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  });
  assert.equal(verifyRecallWebhook(body, headers, secret, timestamp), true);
  assert.equal(verifyRecallWebhook(`${body} `, headers, secret, timestamp), false);
  assert.equal(verifyRecallWebhook(body, headers, secret, timestamp + 301), false);
});

test("model output can reference only supplied evidence", () => {
  assert.deepEqual(parseModelSuggestion('{"text":"Ask for the date.","evidenceIds":["source-1"]}', new Set(["source-1"])), {
    text: "Ask for the date.",
    evidenceIds: ["source-1"],
  });
  assert.throws(() => parseModelSuggestion("not json", new Set()));
  assert.throws(() => parseModelSuggestion('{"text":"x","evidenceIds":["secret"]}', new Set(["source-1"])));
  assert.throws(() => parseModelSuggestion('{"text":"x","evidenceIds":["source-1","source-1"]}', new Set(["source-1"])));
});

test("evidence bounding never exceeds the prompt budget", () => {
  const evidence = [
    { id: "a", kind: "source" as const, title: "A", excerpt: "1234", occurredAt: null, factIds: [] },
    { id: "b", kind: "utterance" as const, title: "B", excerpt: "5678", occurredAt: null, factIds: [] },
  ];
  assert.deepEqual(boundEvidence(evidence, 6).map((item) => item.excerpt), ["1234", "56"]);
  assert.deepEqual(boundEvidence(evidence, 0), []);
});

test("origin and media bearer checks reject cross-site or malformed requests", () => {
  const previous = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://myduo.example";
  try {
    assert.doesNotThrow(() => assertMutationOrigin(new Request("https://myduo.example/api", { headers: { origin: "https://myduo.example" } })));
    assert.throws(
      () => assertMutationOrigin(new Request("https://myduo.example/api", { headers: { origin: "https://evil.example" } })),
      AuthError,
    );
  } finally {
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  }
  const token = "a".repeat(32);
  assert.equal(
    mediaTokenFrom(new Request("https://myduo.example", { headers: { authorization: `Bearer ${token}` } })),
    createHash("sha256").update(token).digest("hex"),
  );
  assert.throws(() => mediaTokenFrom(new Request("https://myduo.example")));
});

test("a successful login can clear accumulated failures", () => {
  const key = `login-${Date.now()}`;
  for (let attempt = 0; attempt < 4; attempt += 1) assert.equal(consumeLoginAttempt(key, 1_000), true);
  resetLoginAttempts(key);
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(consumeLoginAttempt(key, 2_000), true);
  assert.equal(consumeLoginAttempt(key, 2_000), false);
  resetLoginAttempts(key);
});

test("Recall status payloads require the provider envelope", () => {
  assert.equal(parseStatusEvent({ event: "bot.done", data: { data: { updated_at: "2026-09-12T12:00:00Z" }, bot: { id: "bot-1", metadata: {} } } }).event, "bot.done");
  assert.throws(() => parseStatusEvent({ event: "bot.done", data: { bot: { id: "bot-1" } } }));
});
