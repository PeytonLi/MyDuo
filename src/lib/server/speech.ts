import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { approvalRequestSchema, speechStateSchema, type ApprovalRequest, type SpeechState } from "../contracts";
import { readQuery, writeQuery } from "./db";
import { elevenLabsConfig } from "./env";
import { MeetingError } from "./meetings";

const bootstrapSchema = z.object({
  sessionId: z.string().uuid(),
  token: z.string().min(20).max(200),
});

const acknowledgementSchema = z.object({
  commandId: z.string().uuid(),
  status: z.enum(["playing", "completed", "failed", "uncertain"]),
  errorCode: z.string().trim().max(100).optional(),
});

const ACTIVE_SPEECH = ["queued", "claimed", "preparing", "playing"];
const TRANSITIONS: Record<string, string[]> = {
  preparing: ["playing", "failed", "uncertain"],
  playing: ["completed", "failed", "uncertain"],
};

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
       OPTIONAL MATCH (active:SpeechCommand {id: s.activeSpeechId})
       RETURN s, g, active`,
      { sessionId, ownerId, suggestionId: input.suggestionId, version: input.version },
    );
    if (!result.records.length) throw new MeetingError("Suggestion or meeting not found", "SUGGESTION_NOT_FOUND", 404);
    const record = result.records[0];
    const session = record.get("s").properties as Record<string, unknown>;
    const suggestion = record.get("g").properties as Record<string, unknown>;
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
    const created = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})-[:HAS_SUGGESTION]->(g:Suggestion {id: $suggestionId})
       CREATE (c:SpeechCommand {
         id: $id, sessionId: $sessionId, clientRequestId: $clientRequestId,
         suggestionId: $suggestionId, suggestionVersion: $version,
         approvedText: $approvedText, reviewedTranscriptRevision: $reviewedTranscriptRevision,
         status: 'queued', createdAt: $now, updatedAt: $now, expiresAt: $expiresAt
       })
       CREATE (s)-[:HAS_SPEECH]->(c)
       SET s.activeSpeechId = $id, s.updatedAt = $now, g.status = 'approved', g.updatedAt = $now
       RETURN c`,
      { id, sessionId, ownerId, ...input, now, expiresAt },
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
       OPTIONAL MATCH (expired:SpeechCommand {sessionId: s.id, status: 'queued'})
       WHERE datetime(expired.expiresAt) <= datetime()
       SET expired.status = 'expired', expired.updatedAt = $now,
           s.activeSpeechId = CASE WHEN s.activeSpeechId = expired.id THEN null ELSE s.activeSpeechId END`,
      { mediaTokenHash, sessionId, now },
    );
    const result = await tx.run(
      `MATCH (a:AccessSession {tokenHash: $mediaTokenHash, scopedSessionId: $sessionId, kind: 'media'}),
             (s:Session {id: $sessionId})
       WHERE a.expiresAt > datetime() AND s.status IN ['joining', 'waiting', 'listening', 'uncertain']
       SET s.mediaLastSeenAt = $now, s.updatedAt = $now
       WITH s
       OPTIONAL MATCH (c:SpeechCommand {sessionId: s.id, status: 'queued'})
       WHERE datetime(c.expiresAt) > datetime()
       WITH s, c ORDER BY c.createdAt ASC
       WITH s, collect(c)[0] AS command
       FOREACH (_ IN CASE WHEN command IS NULL THEN [] ELSE [1] END |
         SET command.status = 'claimed', command.claimedAt = $now, command.updatedAt = $now
       )
       RETURN s.stopRevision AS stopRevision, command`,
      { mediaTokenHash, sessionId, now },
    );
    if (!result.records.length) throw new MeetingError("Media authorization expired", "MEDIA_UNAUTHORIZED", 401);
    const record = result.records[0];
    const command = record.get("command")?.properties as Record<string, unknown> | undefined;
    return { stopRevision: asNumber(record.get("stopRevision")), command: command ? mapSpeech(command) : null };
  });
}

export async function acknowledgeCommand(
  mediaTokenHash: string,
  sessionId: string,
  input: z.infer<typeof acknowledgementSchema>,
) {
  return writeQuery(async (tx) => {
    const found = await tx.run(
      `MATCH (a:AccessSession {tokenHash: $mediaTokenHash, scopedSessionId: $sessionId, kind: 'media'}),
             (s:Session {id: $sessionId}), (c:SpeechCommand {id: $commandId, sessionId: $sessionId})
       WHERE a.expiresAt > datetime()
       RETURN s, c`,
      { mediaTokenHash, sessionId, commandId: input.commandId },
    );
    if (!found.records.length) throw new MeetingError("Speech command not found", "COMMAND_NOT_FOUND", 404);
    const current = found.records[0].get("c").properties.status as string;
    if (!TRANSITIONS[current]?.includes(input.status)) {
      throw new MeetingError("Invalid speech state transition", "INVALID_SPEECH_STATE", 409);
    }
    const terminal = ["completed", "failed", "uncertain"].includes(input.status);
    const updated = await tx.run(
      `MATCH (s:Session {id: $sessionId}), (c:SpeechCommand {id: $commandId, sessionId: $sessionId})
       SET c.status = $status, c.errorCode = $errorCode, c.updatedAt = $now,
           s.activeSpeechId = CASE WHEN $terminal THEN null ELSE s.activeSpeechId END,
           s.updatedAt = $now
       RETURN c`,
      { sessionId, commandId: input.commandId, status: input.status, errorCode: input.errorCode || null, terminal, now: new Date().toISOString() },
    );
    return mapSpeech(updated.records[0].get("c").properties);
  });
}

export async function prepareApprovedAudio(mediaTokenHash: string, sessionId: string, commandId: string) {
  return writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (a:AccessSession {tokenHash: $mediaTokenHash, scopedSessionId: $sessionId, kind: 'media'}),
             (s:Session {id: $sessionId}), (c:SpeechCommand {id: $commandId, sessionId: $sessionId, status: 'claimed'})
       WHERE a.expiresAt > datetime() AND s.activeSpeechId = c.id AND datetime(c.expiresAt) > datetime()
       SET c.status = 'preparing', c.updatedAt = $now
       RETURN c.approvedText AS approvedText`,
      { mediaTokenHash, sessionId, commandId, now: new Date().toISOString() },
    );
    const text = result.records[0]?.get("approvedText");
    if (typeof text !== "string") throw new MeetingError("Speech command cannot be prepared", "COMMAND_NOT_CLAIMED", 409);
    return text;
  });
}

export async function synthesizeApprovedText(text: string) {
  const { apiKey, voiceId, model } = elevenLabsConfig();
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model, enable_logging: false }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new MeetingError(`Voice synthesis failed (${response.status})`, "TTS_FAILED", 502);
  return response.arrayBuffer();
}

export async function failCommand(sessionId: string, commandId: string, errorCode: string) {
  await writeQuery(async (tx) => {
    await tx.run(
      `MATCH (s:Session {id: $sessionId}), (c:SpeechCommand {id: $commandId, sessionId: $sessionId})
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
