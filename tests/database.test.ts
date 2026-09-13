import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createAddonPair, exchangeAddonPair } from "../src/lib/server/addon";
import { AuthError, requireOperator } from "../src/lib/server/auth";
import { getDriver, readQuery, writeQuery } from "../src/lib/server/db";
import { elevenLabsVoices } from "../src/lib/server/env";
import { applyRecallStatus, createMeeting, getSessionState, listMeetingSessions, MeetingError } from "../src/lib/server/meetings";
import { createMemory, deleteMemory, getProfile, getSuggestionContext, listMemory, updateProfile } from "../src/lib/server/memory";
import {
  acknowledgeCommand,
  assertApprovedAudioActive,
  assertMediaSession,
  exchangeMediaBootstrap,
  failCommand,
  heartbeatAndClaim,
  prepareApprovedAudio,
  queueSpeech,
  stopSpeech,
} from "../src/lib/server/speech";
import { dismissSuggestion, reserveSuggestion, setAutoSuggestionEnabled } from "../src/lib/server/suggestions";
import { ingestTranscript, parseTranscriptEvent } from "../src/lib/server/transcripts";

test("Neo4j regression: memory, webhooks, media authority, and speech state", { timeout: 60_000 }, async () => {
  const runId = randomUUID();
  const ownerId = `qa-regression-${runId}`;
  const providerBotId = `qa-bot-${runId}`;
  const sessionId = randomUUID();
  const statusDeliveryId = `qa-status-${runId}`;
  const transcriptDeliveryId = `qa-transcript-${runId}`;

  try {
    const [firstVoice, secondVoice] = elevenLabsVoices();
    const profile = { role: "QA lead", priorities: "Correct state", tone: "Direct", responseExamples: "Show the evidence.", selectedVoiceId: firstVoice.id };
    assert.deepEqual(await updateProfile(ownerId, profile), profile);
    assert.deepEqual(await getProfile(ownerId), profile);
    await assert.rejects(() => updateProfile(ownerId, { ...profile, selectedVoiceId: "not-an-allowed-voice" }));

    const project = await createMemory(ownerId, { kind: "project", name: `Regression ${runId}` });
    const publicSource = await createMemory(ownerId, {
      kind: "source",
      projectId: project.id,
      title: "Approved note",
      text: "Public launch waits for the security review.",
      allowMeetingUse: true,
    });
    const privateSource = await createMemory(ownerId, {
      kind: "source",
      projectId: project.id,
      title: "Private note",
      text: "Never expose this note.",
      allowMeetingUse: false,
    });
    await createMemory(ownerId, {
      kind: "fact",
      projectId: project.id,
      factKind: "dependency",
      text: "Security review is required.",
      sourceIds: [publicSource.id],
      ownerName: "Morgan",
      dependsOnFactIds: [],
    });
    const memory = await listMemory(ownerId, project.id);
    assert.equal(memory.projects.length, 1);
    assert.equal(memory.sources.length, 2);
    assert.equal(memory.facts.length, 1);

    const previousBaseUrl = process.env.APP_BASE_URL;
    delete process.env.APP_BASE_URL;
    try {
      await assert.rejects(() => createMeeting(ownerId, { meetingUrl: "https://meet.google.com/abc-defg-hij", projectId: project.id }), /APP_BASE_URL/);
    } finally {
      if (previousBaseUrl === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = previousBaseUrl;
    }
    const accidentalSessions = await readQuery(async (tx) => {
      const result = await tx.run("MATCH (s:Session {ownerId: $ownerId}) RETURN count(s) AS count", { ownerId });
      return result.records[0].get("count").toNumber();
    });
    assert.equal(accidentalSessions, 0, "configuration failure must not reserve an active meeting");

    await writeQuery(async (tx) => {
      await tx.run(
        `MATCH (p:Project {id: $projectId, ownerId: $ownerId})
         CREATE (s:Session {
           id: $sessionId, ownerId: $ownerId, projectId: $projectId,
           providerBotId: $providerBotId, meetingUrl: 'https://meet.google.com/abc-defg-hij',
           status: 'joining', transcriptRevision: 0, stopRevision: 0,
           createdAt: $now, updatedAt: $now
         })
         CREATE (p)-[:HAS_SESSION]->(s)`,
        { ownerId, projectId: project.id, sessionId, providerBotId, now: new Date().toISOString() },
      );
    });

    const statusEvent = {
      event: "bot.in_call_recording",
      data: { data: { updated_at: "2026-09-12T12:00:01Z" }, bot: { id: providerBotId, metadata: { myduo_session_id: sessionId } } },
    };
    assert.deepEqual(await applyRecallStatus(statusDeliveryId, statusEvent), { knownSession: true, ignored: false, duplicate: false });
    assert.deepEqual(await applyRecallStatus(statusDeliveryId, statusEvent), { knownSession: true, ignored: false, duplicate: true });
    await applyRecallStatus(`qa-stale-status-${runId}`, {
      event: "bot.joining_call",
      data: { data: { updated_at: "2026-09-12T12:00:00Z" }, bot: { id: providerBotId, metadata: { myduo_session_id: sessionId } } },
    });
    assert.equal((await getSessionState(ownerId, sessionId)).status, "listening", "older status events must not move a session backward");

    const transcriptEvent = parseTranscriptEvent({
      event: "transcript.data",
      data: {
        data: {
          words: [
            { text: "Can", start_timestamp: { relative: 2 }, end_timestamp: { relative: 2.1 } },
            { text: "we", start_timestamp: { relative: 2.1 }, end_timestamp: { relative: 2.2 } },
            { text: "launch?", start_timestamp: { relative: 2.2 }, end_timestamp: { relative: 2.5 } },
          ],
          participant: { id: "person-1", name: "Alex" },
        },
        transcript: { id: `transcript-${runId}` },
        bot: { id: providerBotId },
      },
    });
    assert.deepEqual(await ingestTranscript(transcriptDeliveryId, transcriptEvent), { knownSession: true, duplicate: false });
    assert.deepEqual(await ingestTranscript(transcriptDeliveryId, transcriptEvent), { knownSession: true, duplicate: true });

    const state = await getSessionState(ownerId, sessionId);
    assert.equal(state.status, "listening");
    assert.equal(state.transcriptRevision, 1);
    assert.equal(state.recentUtterances.length, 1);
    assert.equal(state.recentUtterances[0].text, "Can we launch?");
    assert.equal(state.meetingPlatform, "google_meet", "sessions without a stored platform default to Google Meet copy");
    await writeQuery(async (tx) => {
      await tx.run("MATCH (s:Session {id: $sessionId}) SET s.meetingPlatform = 'zoom'", { sessionId });
    });
    assert.equal((await getSessionState(ownerId, sessionId)).meetingPlatform, "zoom");

    const pairing = await createAddonPair(ownerId, sessionId);
    const addon = await exchangeAddonPair(pairing.code);
    const addonRequest = new Request("https://myduo.example/api", { headers: { authorization: `Bearer ${addon.token}` } });
    assert.deepEqual(await requireOperator(addonRequest, sessionId), { ownerId });
    await assert.rejects(() => requireOperator(addonRequest, randomUUID()), AuthError);
    await assert.rejects(() => exchangeAddonPair(pairing.code));

    await writeQuery(async (tx) => {
      await tx.run(
        `CREATE (:Suggestion {
           id: $id, ownerId: $ownerId, sessionId: $sessionId, status: 'approved',
           generatedText: 'The launch is Friday.', approvedText: 'Friday is possible after security approval.',
           approvedAt: $now
         })`,
        { id: randomUUID(), ownerId, sessionId, now: new Date().toISOString() },
      );
    });
    const context = await getSuggestionContext(ownerId, sessionId, {
      mode: "answer",
      selectedUtteranceIds: [state.recentUtterances[0].id],
      transcriptRevision: 1,
    });
    assert.ok(context.evidence.some((item) => item.id === publicSource.id));
    assert.ok(context.evidence.some((item) => item.id === state.recentUtterances[0].id));
    assert.ok(!context.evidence.some((item) => item.id === privateSource.id));
    assert.deepEqual(context.responseTargets.map((item) => item.text), ["Can we launch?"]);
    assert.deepEqual(context.learnedEdits, [{
      draft: "The launch is Friday.",
      approved: "Friday is possible after security approval.",
    }]);

    const suggestionId = randomUUID();
    await writeQuery(async (tx) => {
      await tx.run(
        `MATCH (s:Session {id: $sessionId})
         CREATE (g:Suggestion {
           id: $suggestionId, ownerId: $ownerId, sessionId: $sessionId,
           version: 1, mode: 'answer', text: $text, generatedText: $text, evidenceIds: [$sourceId],
           evidenceJson: $evidenceJson, basis: 'notes', transcriptRevision: 1,
           status: 'ready', createdAt: $now
         })
         CREATE (s)-[:HAS_SUGGESTION]->(g)`,
        {
          sessionId,
          suggestionId,
          ownerId,
          sourceId: publicSource.id,
          text: "The public launch waits for the security review.",
          evidenceJson: JSON.stringify([]),
          now: new Date().toISOString(),
        },
      );
    });

    const bootstrapToken = `bootstrap_${randomUUID()}_token`;
    await writeQuery(async (tx) => {
      await tx.run(
        `CREATE (:AccessSession {
           tokenHash: $tokenHash, scopedSessionId: $sessionId, kind: 'media_bootstrap',
           expiresAt: datetime($expiresAt), createdAt: $now
         })`,
        {
          tokenHash: createHash("sha256").update(bootstrapToken).digest("hex"),
          sessionId,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          now: new Date().toISOString(),
        },
      );
    });
    const media = await exchangeMediaBootstrap({ sessionId, token: bootstrapToken });
    await assert.rejects(() => exchangeMediaBootstrap({ sessionId, token: bootstrapToken }));
    const mediaTokenHash = createHash("sha256").update(media.token).digest("hex");
    await assert.doesNotReject(() => assertMediaSession(mediaTokenHash, sessionId));
    assert.equal((await heartbeatAndClaim(mediaTokenHash, sessionId)).command, null);

    const clientRequestId = randomUUID();
    const approval = {
      suggestionId,
      version: 1,
      approvedText: "The public launch must wait for the security review.",
      clientRequestId,
      reviewedTranscriptRevision: 1,
    };
    await assert.rejects(
      () => queueSpeech(ownerId, sessionId, { ...approval, reviewedTranscriptRevision: 0 }),
      (error) => error instanceof MeetingError && error.code === "SUGGESTION_STALE",
    );
    await assert.rejects(
      () => queueSpeech("another-owner", sessionId, approval),
      (error) => error instanceof MeetingError && error.code === "SUGGESTION_NOT_FOUND",
    );
    const queued = await queueSpeech(ownerId, sessionId, approval);
    assert.equal(queued.status, "queued");
    assert.equal((await queueSpeech(ownerId, sessionId, approval)).id, queued.id);
    const approvedExample = await readQuery(async (tx) => {
      const result = await tx.run(
        "MATCH (g:Suggestion {id: $suggestionId}) RETURN g.generatedText AS draft, g.approvedText AS approved, g.approvedAt AS approvedAt",
        { suggestionId },
      );
      return result.records[0];
    });
    assert.equal(approvedExample.get("draft"), "The public launch waits for the security review.");
    assert.equal(approvedExample.get("approved"), approval.approvedText);
    assert.ok(approvedExample.get("approvedAt"));
    await updateProfile(ownerId, { ...profile, selectedVoiceId: secondVoice.id });

    const claimed = await heartbeatAndClaim(mediaTokenHash, sessionId);
    assert.equal(claimed.command?.id, queued.id);
    assert.equal(claimed.command?.status, "claimed");
    assert.equal((await heartbeatAndClaim(mediaTokenHash, sessionId)).command, null);
    await assert.rejects(
      () => acknowledgeCommand(mediaTokenHash, sessionId, { commandId: queued.id, status: "completed" }),
      (error) => error instanceof MeetingError && error.code === "INVALID_SPEECH_STATE",
    );
    assert.deepEqual(await prepareApprovedAudio(mediaTokenHash, sessionId, queued.id), { text: approval.approvedText, voiceId: firstVoice.id });
    await assert.doesNotReject(() => assertApprovedAudioActive(mediaTokenHash, sessionId, queued.id));
    assert.equal((await acknowledgeCommand(mediaTokenHash, sessionId, { commandId: queued.id, status: "completed" })).status, "completed");
    assert.equal((await acknowledgeCommand(mediaTokenHash, sessionId, { commandId: queued.id, status: "playing" })).status, "completed");
    assert.equal((await acknowledgeCommand(mediaTokenHash, sessionId, { commandId: queued.id, status: "completed" })).status, "completed");

    const secondSuggestionId = randomUUID();
    await writeQuery(async (tx) => {
      await tx.run(
        `MATCH (s:Session {id: $sessionId})
         CREATE (g:Suggestion {
           id: $suggestionId, ownerId: $ownerId, sessionId: $sessionId,
           version: 2, mode: 'support', text: 'Mention the dependency.', evidenceIds: [$sourceId],
           evidenceJson: '[]', basis: 'notes', transcriptRevision: 1,
           status: 'ready', createdAt: $now
         })
         CREATE (s)-[:HAS_SUGGESTION]->(g)`,
        { sessionId, suggestionId: secondSuggestionId, ownerId, sourceId: publicSource.id, now: new Date().toISOString() },
      );
    });
    const second = await queueSpeech(ownerId, sessionId, {
      suggestionId: secondSuggestionId,
      version: 2,
      approvedText: "Mention the dependency.",
      clientRequestId: randomUUID(),
      reviewedTranscriptRevision: 1,
    });
    assert.equal(second.status, "queued");
    assert.equal((await heartbeatAndClaim(mediaTokenHash, sessionId)).command?.status, "claimed");
    await prepareApprovedAudio(mediaTokenHash, sessionId, second.id);
    assert.equal((await stopSpeech(ownerId, sessionId)).stopRevision, 1);
    await assert.rejects(
      () => assertApprovedAudioActive(mediaTokenHash, sessionId, second.id),
      (error) => error instanceof MeetingError && error.code === "COMMAND_CANCELLED",
    );
    await failCommand(sessionId, second.id, "TTS_FAILED");
    assert.equal((await acknowledgeCommand(mediaTokenHash, sessionId, { commandId: second.id, status: "playing" })).status, "cancelled");
    const afterStop = await getSessionState(ownerId, sessionId);
    assert.equal(afterStop.activeSpeech, null);

    const readySuggestionId = randomUUID();
    await writeQuery(async (tx) => {
      await tx.run(
        `MATCH (s:Session {id: $sessionId})
         CREATE (g:Suggestion {
           id: $suggestionId, ownerId: $ownerId, sessionId: $sessionId,
           version: 3, mode: 'clarify', text: 'Which launch?', evidenceIds: [$sourceId],
           evidenceJson: '[]', basis: 'notes', transcriptRevision: 1,
           status: 'ready', createdAt: $now
         })
         CREATE (s)-[:HAS_SUGGESTION]->(g)`,
        { sessionId, suggestionId: readySuggestionId, ownerId, sourceId: publicSource.id, now: new Date().toISOString() },
      );
    });
    assert.equal((await deleteMemory(ownerId, { kind: "source", id: publicSource.id })).invalidatedSuggestions, 1);
    const invalidated = await readQuery(async (tx) => {
      const result = await tx.run("MATCH (g:Suggestion {id: $id}) RETURN g.status AS status", { id: readySuggestionId });
      return String(result.records[0].get("status"));
    });
    assert.equal(invalidated, "failed");

    const commandCount = await readQuery(async (tx) => {
      const result = await tx.run(
        "MATCH (c:SpeechCommand {sessionId: $sessionId, clientRequestId: $clientRequestId}) RETURN count(c) AS count",
        { sessionId, clientRequestId },
      );
      return result.records[0].get("count").toNumber();
    });
    assert.equal(commandCount, 1, "idempotent approval must create exactly one command");

    await writeQuery(async (tx) => {
      await tx.run("MATCH (s:Session {id: $sessionId}) SET s.status = 'ended', s.updatedAt = $now", {
        sessionId,
        now: new Date().toISOString(),
      });
    });
    const history = (await listMeetingSessions(ownerId)).find((meeting) => meeting.id === sessionId);
    assert.equal(history?.transcriptCount, 1);
    assert.equal(history?.reviewState, "pending", "an ended transcript should remain visible for memory review");
  } finally {
    await writeQuery(async (tx) => {
      await tx.run(
        `MATCH (n)
         WHERE n.ownerId = $ownerId OR n.sessionId = $sessionId OR n.scopedSessionId = $sessionId
            OR n.id IN [$statusDeliveryId, $transcriptDeliveryId, $staleStatusDeliveryId]
         DETACH DELETE n`,
        { ownerId, sessionId, statusDeliveryId, transcriptDeliveryId, staleStatusDeliveryId: `qa-stale-status-${runId}` },
      );
    });
  }
});

test("automatic suggestions reserve once and respect dismissal suppression", { timeout: 30_000 }, async () => {
  const ownerId = `qa-auto-${randomUUID()}`;
  const projectId = randomUUID();
  const sessionId = randomUUID();
  const request = { mode: "clarify" as const, selectedUtteranceIds: [], transcriptRevision: 1 };
  try {
    await writeQuery(async (tx) => {
      await tx.run(
        `CREATE (project:Project {id: $projectId, ownerId: $ownerId, name: 'Auto QA'})
         CREATE (session:Session {
           id: $sessionId, ownerId: $ownerId, projectId: $projectId, status: 'listening',
           transcriptRevision: 1, stopRevision: 0, suggestionVersion: 0, createdAt: $now
         })
         CREATE (utterance:Utterance {
           id: $utteranceId, sessionId: $sessionId, revision: 1, isBot: false,
           speakerName: 'Alex', text: 'Which plan do you mean?', startMs: 0, endMs: 1000
         })
         CREATE (project)-[:HAS_SESSION]->(session)
         CREATE (session)-[:HAS_UTTERANCE]->(utterance)`,
        { ownerId, projectId, sessionId, utteranceId: randomUUID(), now: new Date().toISOString() },
      );
    });
    assert.equal((await setAutoSuggestionEnabled(ownerId, sessionId, { enabled: true })).enabled, true);

    const createdAt = new Date().toISOString();
    const reservations = await Promise.all([
      reserveSuggestion(ownerId, sessionId, request, randomUUID(), createdAt, "auto"),
      reserveSuggestion(ownerId, sessionId, request, randomUUID(), createdAt, "auto"),
    ]);
    assert.equal(reservations.filter((version) => version !== null).length, 1, "a transcript revision must reserve once");

    const suggestionId = await writeQuery(async (tx) => {
      const result = await tx.run(
        `MATCH (session:Session {id: $sessionId})-[:HAS_SUGGESTION]->(suggestion:Suggestion {trigger: 'auto'})
         SET suggestion.status = 'ready', suggestion.text = 'Which plan?', suggestion.evidenceJson = '[]'
         RETURN suggestion.id AS id`,
        { sessionId },
      );
      return String(result.records[0].get("id"));
    });
    await dismissSuggestion(ownerId, suggestionId);
    const mutedUntil = await readQuery(async (tx) => {
      const result = await tx.run(
        `MATCH (session:Session {id: $sessionId})
         RETURN session.autoMutedUntilRevision AS revision`,
        { sessionId },
      );
      return result.records[0].get("revision").toNumber();
    });
    assert.equal(mutedUntil, 3, "dismissal must suppress the same revision and the next two");

    const speechCount = await readQuery(async (tx) => {
      const result = await tx.run("MATCH (speech:SpeechCommand {sessionId: $sessionId}) RETURN count(speech) AS count", { sessionId });
      return result.records[0].get("count").toNumber();
    });
    assert.equal(speechCount, 0, "automatic drafts must not enqueue speech");
  } finally {
    await writeQuery(async (tx) => {
      await tx.run("MATCH (node) WHERE node.ownerId = $ownerId OR node.sessionId = $sessionId DETACH DELETE node", { ownerId, sessionId });
    });
  }
});

test.after(async () => {
  await getDriver().close();
});
