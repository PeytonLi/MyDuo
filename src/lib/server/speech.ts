import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { approvalRequestSchema, speechStateSchema, type ApprovalRequest, type SpeechState } from "../contracts";
import { readQuery, writeQuery } from "./db";
import { allowedVoice, elevenLabsConfig, elevenLabsVoices } from "./env";
import { MeetingError } from "./meetings";

const bootstrapSchema = z.object({
  sessionId: z.string().uuid(),
  token: z.string().min(20).max(200),
});

const acknowledgementSchema = z.object({
  commandId: z.string().uuid(),
  status: z.enum(["playing", "completed", "cancelled", "failed", "uncertain"]),
  errorCode: z.string().trim().max(100).optional(),
});

const ACTIVE_SPEECH = ["queued", "claimed", "preparing", "playing"];
const TRANSITIONS: Record<string, string[]> = {
  claimed: ["cancelled", "failed", "uncertain"],
  preparing: ["playing", "completed", "cancelled", "failed", "uncertain"],
  playing: ["completed", "cancelled", "failed", "uncertain"],
};
const SETTLED_SPEECH = ["completed", "cancelled", "failed", "uncertain", "expired"];

export const VOICE_PREVIEW_TEXT = "Hi, I’m your MyDuo. I’ll speak only when you approve it.";

// ponytail: this limiter targets the single-instance demo; move it to shared storage before horizontal scaling.
const previewWindows = new Map<string, { count: number; resetAt: number }>();

export function consumeVoicePreview(ownerId: string, now = Date.now()) {
  const current = previewWindows.get(ownerId);
  if (!current || current.resetAt <= now) {
    previewWindows.set(ownerId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 5) return false;
  current.count += 1;
  return true;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const asNumber = (value: unknown) =>
  value && typeof value === "object" && "toNumber" in value
    ? (value as { toNumber(): number }).toNumber()
    : Number(value ?? 0);

const mapSpeech = (properties: Record<string, unknown>): SpeechState =>
  speechStateSchema.parse({
    id: properties.id,
    status: properties.status,
    approvedText: properties.approvedText,
    createdAt: String(properties.createdAt),
    errorCode: properties.errorCode ? String(properties.errorCode) : null,
  });

export function parseApproval(value: unknown) {
  return approvalRequestSchema.parse(value);
}

export function parseBootstrap(value: unknown) {
  return bootstrapSchema.parse(value);
}

export function parseAcknowledgement(value: unknown) {
  return acknowledgementSchema.parse(value);
}

export function mediaTokenFrom(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/);
  if (!match) throw new MeetingError("Media authorization required", "MEDIA_UNAUTHORIZED", 401);
  return hash(match[1]);
}

export async function exchangeMediaBootstrap(input: z.infer<typeof bootstrapSchema>) {
  const mediaToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
  const now = new Date().toISOString();
  const accepted = await writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (a:AccessSession {
         tokenHash: $bootstrapHash, scopedSessionId: $sessionId, kind: 'media_bootstrap'
       }), (s:Session {id: $sessionId})
       WHERE a.expiresAt > datetime() AND a.usedAt IS NULL
         AND s.status IN ['joining', 'waiting', 'listening', 'uncertain']
       SET a.usedAt = datetime($now)
       CREATE (:AccessSession {
         tokenHash: $mediaHash, scopedSessionId: $sessionId, kind: 'media',
         expiresAt: datetime($expiresAt), createdAt: $now
       })
       RETURN s.id AS id`,
      { sessionId: input.sessionId, bootstrapHash: hash(input.token), mediaHash: hash(mediaToken), now, expiresAt },
    );
    return Boolean(result.records.length);
  });
  if (!accepted) throw new MeetingError("Media link is invalid or expired", "MEDIA_BOOTSTRAP_INVALID", 401);
  return { token: mediaToken, expiresAt };
}

export async function queueSpeech(ownerId: string, sessionId: string, input: ApprovalRequest) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString();
  return writeQuery(async (tx) => {
    const duplicate = await tx.run(
      `MATCH (:Session {id: $sessionId, ownerId: $ownerId})-[:HAS_SPEECH]->
             (c:SpeechCommand {sessionId: $sessionId, clientRequestId: $clientRequestId})
       RETURN c LIMIT 1`,
      { sessionId, ownerId, clientRequestId: input.clientRequestId },
    );
    if (duplicate.records.length) return mapSpeech(duplicate.records[0].get("c").properties);

    const result = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})-[:HAS_SUGGESTION]->(g:Suggestion {
         id: $suggestionId, version: $version
       })
       MATCH (u:User {id: $ownerId})
       OPTIONAL MATCH (active:SpeechCommand {id: s.activeSpeechId})
       RETURN s, g, u, active`,
      { sessionId, ownerId, suggestionId: input.suggestionId, version: input.version },
    );
    if (!result.records.length) throw new MeetingError("Suggestion or meeting not found", "SUGGESTION_NOT_FOUND", 404);
    const record = result.records[0];
    const session = record.get("s").properties as Record<string, unknown>;
    const suggestion = record.get("g").properties as Record<string, unknown>;
    const user = record.get("u").properties as Record<string, unknown>;
    const active = record.get("active")?.properties as Record<string, unknown> | undefined;

    if (session.status !== "listening") throw new MeetingError("The bot is not ready to speak", "SESSION_NOT_LISTENING", 409);
    if (asNumber(session.transcriptRevision) !== input.reviewedTranscriptRevision) {
      throw new MeetingError("The meeting changed. Review this response once more before speaking.", "SUGGESTION_STALE", 409);
    }
    if (suggestion.status !== "ready") throw new MeetingError("This suggestion is no longer ready", "SUGGESTION_NOT_READY", 409);
    if (active && ACTIVE_SPEECH.includes(String(active.status))) {
      throw new MeetingError("MyDuo is already preparing or speaking", "SPEECH_ALREADY_ACTIVE", 409);
    }

    const id = randomUUID();
    const voiceId = allowedVoice(String(user.selectedVoiceId ?? ""))?.id ?? elevenLabsVoices()[0].id;
    const created = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})-[:HAS_SUGGESTION]->(g:Suggestion {id: $suggestionId})
       CREATE (c:SpeechCommand {
         id: $id, sessionId: $sessionId, clientRequestId: $clientRequestId,
         suggestionId: $suggestionId, suggestionVersion: $version,
         approvedText: $approvedText, reviewedTranscriptRevision: $reviewedTranscriptRevision,
         voiceId: $voiceId,
         status: 'queued', createdAt: $now, updatedAt: $now, expiresAt: $expiresAt
       })
       CREATE (s)-[:HAS_SPEECH]->(c)
       SET s.activeSpeechId = $id, s.updatedAt = $now,
           g.status = 'approved', g.approvedText = $approvedText,
           g.approvedAt = $now, g.updatedAt = $now
       RETURN c`,
      { id, sessionId, ownerId, voiceId, ...input, now, expiresAt },
    );
    return mapSpeech(created.records[0].get("c").properties);
  });
}

export async function stopSpeech(ownerId: string, sessionId: string) {
  return writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})
       SET s.stopRevision = coalesce(s.stopRevision, 0) + 1, s.activeSpeechId = null, s.updatedAt = $now
       WITH s
       OPTIONAL MATCH (c:SpeechCommand {sessionId: s.id})
       WHERE c.status IN ['queued', 'claimed', 'preparing', 'playing']
       SET c.status = 'cancelled', c.updatedAt = $now
       RETURN s.stopRevision AS stopRevision`,
      { sessionId, ownerId, now: new Date().toISOString() },
    );
    if (!result.records.length) throw new MeetingError("Meeting session not found", "SESSION_NOT_FOUND", 404);
    return { stopRevision: asNumber(result.records[0].get("stopRevision")) };
  });
}

export async function heartbeatAndClaim(mediaTokenHash: string, sessionId: string) {
  return writeQuery(async (tx) => {
    const now = new Date().toISOString();
    await tx.run(
      `MATCH (a:AccessSession {tokenHash: $mediaTokenHash, scopedSessionId: $sessionId, kind: 'media'}),
             (s:Session {id: $sessionId})
       WHERE a.expiresAt > datetime()
       OPTIONAL MATCH (expired:SpeechCommand {sessionId: s.id})
       WHERE expired.status IN $activeSpeech
         AND datetime(expired.expiresAt) <= datetime()
       SET expired.status = 'expired', expired.updatedAt = $now,
           s.activeSpeechId = CASE WHEN s.activeSpeechId = expired.id THEN null ELSE s.activeSpeechId END`,
      { mediaTokenHash, sessionId, activeSpeech: ACTIVE_SPEECH, now },
    );
    const result = await tx.run(
      `MATCH (a:AccessSession {tokenHash: $mediaTokenHash, scopedSessionId: $sessionId, kind: 'media'}),
             (s:Session {id: $sessionId})
       WHERE a.expiresAt > datetime() AND s.status IN ['joining', 'waiting', 'listening', 'uncertain']
       SET s.mediaLastSeenAt = $now, s.updatedAt = $now
       WITH s
       OPTIONAL MATCH (c:SpeechCommand {sessionId: s.id, status: 'queued'})
       WHERE datetime(c.expiresAt) > datetime() AND size(coalesce(s.floorSpeakerIds, [])) = 0
       WITH s, c ORDER BY c.createdAt ASC
       WITH s, collect(c)[0] AS command
       FOREACH (_ IN CASE WHEN command IS NULL THEN [] ELSE [1] END |
         SET command.status = 'claimed', command.claimedAt = $now, command.updatedAt = $now
       )
       RETURN s.stopRevision AS stopRevision, command,
              size(coalesce(s.floorSpeakerIds, [])) > 0 AS humanSpeaking,
              s.floorQuietSince AS floorQuietSince`,
      { mediaTokenHash, sessionId, now },
    );
    if (!result.records.length) throw new MeetingError("Media authorization expired", "MEDIA_UNAUTHORIZED", 401);
    const record = result.records[0];
    const command = record.get("command")?.properties as Record<string, unknown> | undefined;
    return {
      stopRevision: asNumber(record.get("stopRevision")),
      command: command ? mapSpeech(command) : null,
      floor: {
        humanSpeaking: Boolean(record.get("humanSpeaking")),
        quietSince: record.get("floorQuietSince") ? String(record.get("floorQuietSince")) : null,
      },
    };
  });
}

export async function acknowledgeCommand(
  mediaTokenHash: string,
  sessionId: string,
  input: z.infer<typeof acknowledgementSchema>,
) {
  return writeQuery(async (tx) => {
    const allowedFrom = Object.entries(TRANSITIONS)
      .filter(([, next]) => next.includes(input.status))
      .map(([status]) => status);
    const result = await tx.run(
      `MATCH (a:AccessSession {tokenHash: $mediaTokenHash, scopedSessionId: $sessionId, kind: 'media'}),
             (s:Session {id: $sessionId}), (c:SpeechCommand {id: $commandId, sessionId: $sessionId})
       WHERE a.expiresAt > datetime()
       WITH s, c, c.status AS previousStatus
       FOREACH (_ IN CASE WHEN previousStatus IN $allowedFrom THEN [1] ELSE [] END |
         SET c.status = $status, c.errorCode = $errorCode, c.updatedAt = $now,
             c.playingAt = CASE WHEN $status = 'playing' THEN $now ELSE c.playingAt END,
             c.completedAt = CASE WHEN $status = 'completed' THEN $now ELSE c.completedAt END,
             s.activeSpeechId = CASE WHEN $terminal THEN null ELSE s.activeSpeechId END,
             s.updatedAt = $now
       )
       RETURN c, previousStatus`,
      {
        mediaTokenHash,
        sessionId,
        commandId: input.commandId,
        allowedFrom,
        status: input.status,
        errorCode: input.errorCode || null,
        terminal: ["completed", "cancelled", "failed", "uncertain"].includes(input.status),
        now: new Date().toISOString(),
      },
    );
    const record = result.records[0];
    if (!record) throw new MeetingError("Speech command not found", "COMMAND_NOT_FOUND", 404);
    const previous = String(record.get("previousStatus"));
    if (!allowedFrom.includes(previous) && previous !== input.status && !SETTLED_SPEECH.includes(previous)) {
      throw new MeetingError("Invalid speech state transition", "INVALID_SPEECH_STATE", 409);
    }
    return mapSpeech(record.get("c").properties);
  });
}

export async function prepareApprovedAudio(mediaTokenHash: string, sessionId: string, commandId: string) {
  return writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (a:AccessSession {tokenHash: $mediaTokenHash, scopedSessionId: $sessionId, kind: 'media'}),
             (s:Session {id: $sessionId}), (c:SpeechCommand {id: $commandId, sessionId: $sessionId, status: 'claimed'})
       WHERE a.expiresAt > datetime() AND s.activeSpeechId = c.id AND datetime(c.expiresAt) > datetime()
       SET c.status = 'preparing', c.preparedAt = $now, c.updatedAt = $now
       RETURN c.approvedText AS approvedText, c.voiceId AS voiceId`,
      { mediaTokenHash, sessionId, commandId, now: new Date().toISOString() },
    );
    const record = result.records[0];
    const text = record?.get("approvedText");
    const voiceId = record?.get("voiceId");
    if (typeof text !== "string" || typeof voiceId !== "string") {
      throw new MeetingError("Speech command cannot be prepared", "COMMAND_NOT_CLAIMED", 409);
    }
    return { text, voiceId };
  });
}

export async function assertApprovedAudioActive(mediaTokenHash: string, sessionId: string, commandId: string) {
  const active = await readQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (a:AccessSession {tokenHash: $mediaTokenHash, scopedSessionId: $sessionId, kind: 'media'}),
             (s:Session {id: $sessionId, activeSpeechId: $commandId}),
             (c:SpeechCommand {id: $commandId, sessionId: $sessionId, status: 'preparing'})
       WHERE a.expiresAt > datetime() AND datetime(c.expiresAt) > datetime()
       RETURN c.id AS id`,
      { mediaTokenHash, sessionId, commandId },
    );
    return Boolean(result.records.length);
  });
  if (!active) throw new MeetingError("Speech command was cancelled", "COMMAND_CANCELLED", 409);
}

async function requestTextToSpeech(text: string, voiceId: string, stream: boolean, signal?: AbortSignal) {
  if (!allowedVoice(voiceId)) throw new MeetingError("Voice is not available", "VOICE_NOT_ALLOWED", 400);
  const { apiKey, model } = elevenLabsConfig();
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}${stream ? "/stream" : ""}?output_format=mp3_44100_128&enable_logging=false`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new MeetingError(`Voice synthesis failed (${response.status})`, "TTS_FAILED", 502);
  return response;
}

export async function synthesizeApprovedText(text: string, voiceId: string) {
  return (await requestTextToSpeech(text, voiceId, false)).arrayBuffer();
}

export async function streamApprovedText(text: string, voiceId: string, signal?: AbortSignal) {
  const response = await requestTextToSpeech(text, voiceId, true, signal);
  if (!response.body) throw new MeetingError("Voice synthesis returned no audio", "TTS_FAILED", 502);
  return response.body;
}

export async function failCommand(sessionId: string, commandId: string, errorCode: string) {
  await writeQuery(async (tx) => {
    await tx.run(
      `MATCH (s:Session {id: $sessionId}), (c:SpeechCommand {id: $commandId, sessionId: $sessionId})
       WHERE c.status IN ['claimed', 'preparing', 'playing']
       SET c.status = 'failed', c.errorCode = $errorCode, c.updatedAt = $now,
           s.activeSpeechId = CASE WHEN s.activeSpeechId = c.id THEN null ELSE s.activeSpeechId END`,
      { sessionId, commandId, errorCode, now: new Date().toISOString() },
    );
  });
}

export async function assertMediaSession(mediaTokenHash: string, sessionId: string) {
  const found = await readQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (a:AccessSession {tokenHash: $mediaTokenHash, scopedSessionId: $sessionId, kind: 'media'})
       WHERE a.expiresAt > datetime() RETURN a LIMIT 1`,
      { mediaTokenHash, sessionId },
    );
    return Boolean(result.records.length);
  });
  if (!found) throw new MeetingError("Media authorization expired", "MEDIA_UNAUTHORIZED", 401);
}
