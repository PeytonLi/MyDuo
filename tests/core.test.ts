import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { decideAutoTrigger } from "../src/lib/server/auto-trigger";
import { normalizedEditDistance, summarizeQuality } from "../src/lib/server/evaluation";
import { assistanceRequestSchema, approvalRequestSchema } from "../src/lib/contracts";
import { assertMutationOrigin, AuthError, consumeLoginAttempt, resetLoginAttempts } from "../src/lib/server/auth";
import { parsePairingCode } from "../src/lib/server/addon";
import { latestRecallStatus, normalizeMeetingUrl, parseStatusEvent, recallStatusFromCode, reviewStateForMeeting } from "../src/lib/server/meetings";
import { boundEvidence, graphSearchTerms, parseGraphToolCall } from "../src/lib/server/memory";
import { verifyRecallWebhook } from "../src/lib/server/recall";
import { consumeVoicePreview, mediaTokenFrom, parseAcknowledgement } from "../src/lib/server/speech";
import { parseModelSuggestion } from "../src/lib/server/suggestions";
import { normalizeTranscriptEvent, parseParticipantSpeechEvent, parseTranscriptEvent } from "../src/lib/server/transcripts";

const id = "123e4567-e89b-42d3-a456-426614174000";

test("request contracts enforce limits and identifiers", () => {
  assert.equal(assistanceRequestSchema.parse({ mode: "clarify", selectedUtteranceIds: [], transcriptRevision: 0 }).mode, "clarify");
  assert.throws(() => assistanceRequestSchema.parse({ mode: "answer", selectedUtteranceIds: Array(11).fill(id), transcriptRevision: 0 }));
  assert.throws(() => approvalRequestSchema.parse({ suggestionId: id, version: 1, approvedText: "x".repeat(601), clientRequestId: id, reviewedTranscriptRevision: 0 }));
  assert.equal(parseAcknowledgement({ commandId: id, status: "cancelled", errorCode: "HUMAN_SPEECH" }).status, "cancelled");
});

test("meeting URLs are canonical and restricted", () => {
  assert.equal(normalizeMeetingUrl("https://meet.google.com/abc-defg-hij?authuser=1"), "https://meet.google.com/abc-defg-hij");
  assert.equal(normalizeMeetingUrl("https://us02web.zoom.us/j/12345678901?pwd=a+b&tracking=no"), "https://us02web.zoom.us/j/12345678901?pwd=a%20b");
  for (const value of [
    "http://meet.google.com/abc-defg-hij",
    "https://evil.example/abc-defg-hij",
    "https://meet.google.com/not-a-code/extra",
    "https://zoom.us.evil.example/j/123456789",
    "https://zoom.us/j/123",
  ]) {
    assert.throws(() => normalizeMeetingUrl(value));
  }
});

test("Meet add-on pairing codes are normalized and constrained", () => {
  assert.equal(parsePairingCode({ code: " a1b2c3d4e5 " }).code, "A1B2C3D4E5");
  assert.throws(() => parsePairingCode({ code: "A1B2C3D4" }));
  assert.throws(() => parsePairingCode({ code: "A1B2C3D4EZ" }));
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

test("Recall participant speech events require floor timing and identity", () => {
  const event = parseParticipantSpeechEvent({
    event: "participant_events.speech_on",
    data: {
      data: {
        participant: { id: 7, name: "Alex" },
        timestamp: { absolute: "2026-09-12T12:00:02Z", relative: 2 },
        data: null,
      },
      bot: { id: "bot-1" },
    },
  });
  assert.equal(event.event, "participant_events.speech_on");
  assert.equal(event.data.data.participant.id, 7);
  assert.throws(() => parseParticipantSpeechEvent({
    event: "participant_events.speech_on",
    data: { data: { participant: { id: 7, name: "Alex" } }, bot: { id: "bot-1" } },
  }));
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

test("graph tools are allowlisted, bounded, and tokenized deterministically", () => {
  assert.deepEqual(graphSearchTerms("What does SECURITY approval block for Friday's launch?"), [
    "security", "approval", "block", "friday's", "launch",
  ]);
  assert.deepEqual(parseGraphToolCall("search_project_knowledge", '{"query":"security approval","limit":4}'), {
    name: "search_project_knowledge", query: "security approval", limit: 4,
  });
  assert.deepEqual(parseGraphToolCall("trace_dependencies", `{"factIds":["${id}"]}`), {
    name: "trace_dependencies", factIds: [id], depth: 3,
  });
  assert.throws(() => parseGraphToolCall("run_cypher", '{"query":"MATCH (n) RETURN n"}'));
  assert.throws(() => parseGraphToolCall("trace_dependencies", '{"factIds":[]}'));
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

test("voice previews are rate limited per operator", () => {
  const ownerId = `preview-${Date.now()}`;
  for (let request = 0; request < 5; request += 1) assert.equal(consumeVoicePreview(ownerId, 1_000), true);
  assert.equal(consumeVoicePreview(ownerId, 1_000), false);
  assert.equal(consumeVoicePreview(ownerId, 61_001), true);
});

test("Recall status payloads require the provider envelope", () => {
  assert.equal(parseStatusEvent({ event: "bot.done", data: { data: { updated_at: "2026-09-12T12:00:00Z" }, bot: { id: "bot-1", metadata: {} } } }).event, "bot.done");
  assert.throws(() => parseStatusEvent({ event: "bot.done", data: { bot: { id: "bot-1" } } }));
});

test("Recall recovery uses the newest provider status even when history is out of order", () => {
  assert.deepEqual(recallStatusFromCode("bot.in_call_recording"), { status: "listening", rank: 2 });
  assert.deepEqual(latestRecallStatus({
    id,
    metadata: {},
    status: "joining_call",
    statusChanges: [
      { code: "done", subCode: null, createdAt: "2026-09-12T12:30:00Z" },
      { code: "in_waiting_room", subCode: null, createdAt: "2026-09-12T12:00:00Z" },
    ],
  }), { status: "ended", rank: 4, updatedAt: "2026-09-12T12:30:00Z", errorCode: null });
});

test("meeting history flags only unfinished transcript review", () => {
  assert.equal(reviewStateForMeeting("listening", 4, "", 0), "none");
  assert.equal(reviewStateForMeeting("ended", 0, "", 0), "none");
  assert.equal(reviewStateForMeeting("ended", 4, "", 0), "pending");
  assert.equal(reviewStateForMeeting("ended", 4, "ready", 1), "pending");
  assert.equal(reviewStateForMeeting("ended", 4, "ready", 0), "complete");
});
test("automatic drafting only reacts to meaningful meeting events", () => {
  const turn = (text: string, id = randomUUID()) => ({
    id,
    sessionId: randomUUID(),
    speakerId: null,
    speakerName: "Alex",
    text,
    startMs: 0,
    endMs: 1,
    isBot: false,
  });

  assert.equal(decideAutoTrigger([turn("Thanks, that makes sense.")]).shouldDraft, false);
  const targetId = randomUUID();
  assert.deepEqual(
    decideAutoTrigger([turn("Does legal approval block the Friday handoff?", targetId)]),
    {
      shouldDraft: true,
      mode: "answer",
      whyNow: "A new dependency or schedule risk was mentioned.",
      responseTargetIds: [targetId],
    },
  );
  assert.equal(decideAutoTrigger([turn("Actually, the launch moved to Monday.")]).mode, "support");
  assert.equal(decideAutoTrigger([turn("Who owns accessibility review?")]).whyNow, "The meeting raised an unresolved owner or deadline.");
});

test("quality metrics score evidence, edits, and latency", () => {
  assert.equal(normalizedEditDistance("ship Friday", "ship Friday"), 0);
  assert.equal(normalizedEditDistance("", "ship Friday"), 1);
  const summary = summarizeQuality([
    {
      expectedEvidenceIds: ["a", "b"],
      actualEvidenceIds: ["a", "extra"],
      claimCount: 2,
      supportedClaimCount: 1,
      generatedText: "Ship Friday",
      approvedText: "Ship Friday",
      generationMs: 100,
      approvalToAudioMs: 250,
    },
    {
      expectedEvidenceIds: ["c"],
      actualEvidenceIds: ["c"],
      claimCount: 1,
      supportedClaimCount: 1,
      generationMs: 300,
      approvalToAudioMs: 500,
    },
  ]);
  assert.equal(summary.evidencePrecision, 2 / 3);
  assert.equal(summary.evidenceRecall, 2 / 3);
  assert.equal(summary.unsupportedClaimRate, 1 / 3);
  assert.equal(summary.approvalRate, 0.5);
  assert.equal(summary.generationP95Ms, 300);
  assert.equal(summary.approvalToAudioP50Ms, 250);
});
