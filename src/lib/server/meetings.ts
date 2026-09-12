import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { sessionStateSchema, suggestionDraftSchema, type SessionState, type SpeechState } from "../contracts";
import { readQuery, writeQuery } from "./db";
import { recallConfig } from "./env";
import { createRecallBot, RecallError, removeRecallBot } from "./recall";
import { AuthError } from "./auth";

const ACTIVE_STATUSES = ["joining", "waiting", "listening", "ending", "uncertain"];

const statusEventSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.object({
    data: z.object({ code: z.string().optional(), sub_code: z.string().nullable().optional() }).passthrough(),
    bot: z.object({
      id: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
  }),
});

export class MeetingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function meetingErrorResponse(error: unknown) {
  const requestId = randomUUID();
  if (error instanceof AuthError) {
    return Response.json({ code: "UNAUTHORIZED", message: error.message, retryable: false, requestId }, { status: 401 });
  }
  if (error instanceof MeetingError) {
    return Response.json({ code: error.code, message: error.message, retryable: error.status >= 500, requestId }, { status: error.status });
  }
  if (error instanceof RecallError) {
    const status = error.code === "RECALL_TIMEOUT" ? 504 : 502;
    return Response.json({ code: error.code, message: error.message, retryable: true, requestId }, { status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({ code: "INVALID_REQUEST", message: "Check the submitted details", retryable: false, requestId }, { status: 400 });
  }
  if (error instanceof Error && (error.message.startsWith("Missing required environment variable:") || error.message.includes("Invalid URL"))) {
    return Response.json({ code: "NOT_CONFIGURED", message: "Meeting providers are not fully configured.", retryable: false, requestId }, { status: 503 });
  }
  console.error("MyDuo request failed", { requestId, error });
  return Response.json({ code: "INTERNAL_ERROR", message: "Something went wrong", retryable: true, requestId }, { status: 500 });
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const asNumber = (value: unknown) => {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) return (value as { toNumber(): number }).toNumber();
  return Number(value ?? 0);
};

export function normalizeMeetingUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new MeetingError("Enter a valid Google Meet link", "INVALID_MEETING_URL");
  }
  const code = url.pathname.replace(/^\/+|\/+$/g, "");
  if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || !/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) {
    throw new MeetingError("Enter a standard https://meet.google.com/xxx-xxxx-xxx link", "INVALID_MEETING_URL");
  }
  return `https://meet.google.com/${code}`;
}

function mapSpeech(properties: Record<string, unknown> | undefined): SpeechState | null {
  if (!properties) return null;
  return {
    id: String(properties.id),
    status: properties.status as SpeechState["status"],
    approvedText: String(properties.approvedText),
    createdAt: String(properties.createdAt),
    errorCode: properties.errorCode ? String(properties.errorCode) : null,
  };
}

export async function getSessionState(ownerId: string, sessionId: string): Promise<SessionState> {
  return readQuery(async (tx) => {
    const sessionResult = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId}) RETURN s`,
      { sessionId, ownerId },
    );
    if (!sessionResult.records.length) throw new MeetingError("Meeting session not found", "SESSION_NOT_FOUND", 404);
    const session = sessionResult.records[0].get("s").properties as Record<string, unknown>;

    const utteranceResult = await tx.run(
      `MATCH (:Session {id: $sessionId})-[:HAS_UTTERANCE]->(u:Utterance)
       RETURN u ORDER BY u.revision DESC LIMIT 40`,
      { sessionId },
    );
    const recentUtterances = utteranceResult.records
      .map((record) => record.get("u").properties as Record<string, unknown>)
      .reverse()
      .map((turn) => ({
        id: String(turn.id),
        sessionId: String(turn.sessionId),
        speakerId: turn.speakerId == null ? null : String(turn.speakerId),
        speakerName: String(turn.speakerName),
        text: String(turn.text),
        startMs: asNumber(turn.startMs),
        endMs: asNumber(turn.endMs),
        isBot: Boolean(turn.isBot),
      }));

    const suggestionResult = await tx.run(
      `MATCH (:Session {id: $sessionId})-[:HAS_SUGGESTION]->(g:Suggestion)
       WHERE g.status IN ['ready', 'approved']
       RETURN g ORDER BY g.createdAt DESC LIMIT 1`,
      { sessionId },
    );
    const suggestionProps = suggestionResult.records[0]?.get("g")?.properties as Record<string, unknown> | undefined;
    let currentSuggestion = null;
    if (suggestionProps) {
      try {
        currentSuggestion = suggestionDraftSchema.parse({
          id: suggestionProps.id,
          sessionId: suggestionProps.sessionId,
          version: asNumber(suggestionProps.version),
          mode: suggestionProps.mode,
          text: suggestionProps.text,
          evidence: JSON.parse(String(suggestionProps.evidenceJson || "[]")),
          basis: suggestionProps.basis,
          transcriptRevision: asNumber(suggestionProps.transcriptRevision),
          createdAt: String(suggestionProps.createdAt),
        });
      } catch {
        currentSuggestion = null;
      }
    }

    const speechResult = session.activeSpeechId
      ? await tx.run(`MATCH (c:SpeechCommand {id: $id, sessionId: $sessionId}) RETURN c`, {
          id: session.activeSpeechId,
          sessionId,
        })
      : null;
    const activeSpeech = mapSpeech(speechResult?.records[0]?.get("c")?.properties);
    const lastSeen = session.mediaLastSeenAt ? Date.parse(String(session.mediaLastSeenAt)) : 0;

    return sessionStateSchema.parse({
      id: session.id,
      projectId: session.projectId,
      status: session.status,
      transcriptRevision: asNumber(session.transcriptRevision),
      stopRevision: asNumber(session.stopRevision),
      mediaReady: Date.now() - lastSeen < 5_000,
      recentUtterances,
      currentSuggestion,
      activeSpeech,
    });
  });
}

async function reserveSession(ownerId: string, meetingUrl: string, requestedProjectId?: string) {
  const sessionId = randomUUID();
  const fallbackProjectId = randomUUID();
  const bootstrapToken = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const projectId = await writeQuery(async (tx) => {
    const active = await tx.run(
      `MATCH (s:Session {ownerId: $ownerId}) WHERE s.status IN $activeStatuses RETURN s.id AS id LIMIT 1`,
      { ownerId, activeStatuses: ACTIVE_STATUSES },
    );
    if (active.records.length) throw new MeetingError("End the active meeting before starting another", "SESSION_ALREADY_ACTIVE", 409);

    const selected = requestedProjectId
      ? await tx.run(`MATCH (p:Project {id: $requestedProjectId, ownerId: $ownerId}) RETURN p.id AS projectId`, {
          requestedProjectId,
          ownerId,
        })
      : await tx.run(
          `MATCH (u:User {id: $ownerId})
           OPTIONAL MATCH (u)-[:OWNS]->(existing:Project)
           WITH u, existing ORDER BY existing.createdAt ASC
           WITH u, collect(existing)[0] AS existing
           CALL (u, existing) {
             WITH u, existing WHERE existing IS NOT NULL RETURN existing AS p
             UNION
             WITH u, existing WHERE existing IS NULL
             CREATE (p:Project {id: $fallbackProjectId, ownerId: $ownerId, name: 'General', createdAt: $now})
             CREATE (u)-[:OWNS]->(p)
             RETURN p
           }
           RETURN p.id AS projectId`,
          { ownerId, fallbackProjectId, now },
        );
    const selectedProjectId = selected.records[0]?.get("projectId");
    if (!selectedProjectId) throw new MeetingError("Selected project not found", "PROJECT_UNAVAILABLE", 404);

    const project = await tx.run(
      `MATCH (p:Project {id: $projectId, ownerId: $ownerId})
       CREATE (s:Session {
         id: $sessionId, ownerId: $ownerId, projectId: p.id, meetingUrl: $meetingUrl,
         status: 'joining', transcriptRevision: 0, stopRevision: 0,
         createdAt: $now, updatedAt: $now
       })
       CREATE (p)-[:HAS_SESSION]->(s)
       CREATE (:AccessSession {
         tokenHash: $tokenHash, scopedSessionId: $sessionId, kind: 'media_bootstrap',
         expiresAt: datetime($expiresAt), createdAt: $now
       })
       RETURN p.id AS projectId`,
      {
        ownerId,
        projectId: String(selectedProjectId),
        sessionId,
        meetingUrl,
        tokenHash: tokenHash(bootstrapToken),
        expiresAt,
        now,
      },
    );
    const id = project.records[0]?.get("projectId");
    if (!id) throw new MeetingError("Unable to create a meeting project", "PROJECT_UNAVAILABLE", 409);
    return String(id);
  });
  return { sessionId, projectId, bootstrapToken };
}

export async function createMeeting(ownerId: string, input: { meetingUrl: string; projectId?: string }) {
  const meetingUrl = normalizeMeetingUrl(input.meetingUrl);
  const reserved = await reserveSession(ownerId, meetingUrl, input.projectId);
  const { appBaseUrl } = recallConfig();
  const transcriptUrl = `${appBaseUrl}/api/webhooks/recall/transcript`;
  const mediaUrl = `${appBaseUrl}/bot/${reserved.sessionId}#bootstrap=${encodeURIComponent(reserved.bootstrapToken)}`;

  try {
    const botId = await createRecallBot(reserved.sessionId, meetingUrl, transcriptUrl, mediaUrl);
    await writeQuery(async (tx) => {
      await tx.run(
        `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})
         SET s.providerBotId = $botId, s.updatedAt = $now`,
        { sessionId: reserved.sessionId, ownerId, botId, now: new Date().toISOString() },
      );
    });
  } catch (error) {
    const uncertain = error instanceof RecallError && error.code === "RECALL_TIMEOUT";
    await writeQuery(async (tx) => {
      await tx.run(
        `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})
         SET s.status = $status, s.errorCode = $errorCode, s.updatedAt = $now`,
        {
          sessionId: reserved.sessionId,
          ownerId,
          status: uncertain ? "uncertain" : "failed",
          errorCode: error instanceof RecallError ? error.code : "RECALL_UNAVAILABLE",
          now: new Date().toISOString(),
        },
      );
    });
    throw error;
  }

  return getSessionState(ownerId, reserved.sessionId);
}

export async function endMeeting(ownerId: string, sessionId: string) {
  const botId = await writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})
       SET s.status = 'ending', s.stopRevision = coalesce(s.stopRevision, 0) + 1,
           s.updatedAt = $now, s.activeSpeechId = null
       WITH s
       OPTIONAL MATCH (c:SpeechCommand {sessionId: s.id})
       WHERE c.status IN ['queued', 'claimed', 'preparing', 'playing']
       SET c.status = 'cancelled', c.updatedAt = $now
       WITH s
       OPTIONAL MATCH (a:AccessSession {scopedSessionId: s.id}) DETACH DELETE a
       RETURN s.providerBotId AS botId`,
      { sessionId, ownerId, now: new Date().toISOString() },
    );
    if (!result.records.length) throw new MeetingError("Meeting session not found", "SESSION_NOT_FOUND", 404);
    return result.records[0].get("botId") as string | null;
  });

  try {
    if (botId) await removeRecallBot(botId);
    await writeQuery(async (tx) => {
      await tx.run(`MATCH (s:Session {id: $sessionId, ownerId: $ownerId}) SET s.status = 'ended', s.updatedAt = $now`, {
        sessionId,
        ownerId,
        now: new Date().toISOString(),
      });
    });
  } catch (error) {
    await writeQuery(async (tx) => {
      await tx.run(`MATCH (s:Session {id: $sessionId, ownerId: $ownerId}) SET s.status = 'uncertain', s.updatedAt = $now`, {
        sessionId,
        ownerId,
        now: new Date().toISOString(),
      });
    });
    throw error;
  }
  return getSessionState(ownerId, sessionId);
}

export function parseStatusEvent(value: unknown) {
  return statusEventSchema.parse(value);
}

export async function applyRecallStatus(eventId: string, value: z.infer<typeof statusEventSchema>) {
  const status = (() => {
    if (["bot.joining_call"].includes(value.event)) return "joining";
    if (["bot.in_waiting_room"].includes(value.event)) return "waiting";
    if (["bot.in_call_not_recording", "bot.recording_permission_allowed", "bot.in_call_recording"].includes(value.event)) return "listening";
    if (["bot.call_ended", "bot.done"].includes(value.event)) return "ended";
    if (["bot.fatal", "bot.recording_permission_denied"].includes(value.event)) return "failed";
    return null;
  })();
  if (!status) return { knownSession: false, ignored: true, duplicate: false };

  const metadataSessionId = value.data.bot.metadata.myduo_session_id;
  const sessionId = typeof metadataSessionId === "string" ? metadataSessionId : "";
  const freshToken = randomUUID();
  const now = new Date().toISOString();
  return writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session)
       WHERE s.providerBotId = $botId OR s.id = $sessionId
       MERGE (d:RecallDelivery {id: $eventId})
       ON CREATE SET d.createdAt = $now, d.freshToken = $freshToken
       WITH s, d, d.freshToken = $freshToken AS fresh
       FOREACH (_ IN CASE WHEN fresh THEN [1] ELSE [] END |
         SET s.providerBotId = coalesce(s.providerBotId, $botId),
             s.status = CASE
               WHEN s.status = 'ended' THEN 'ended'
               WHEN s.status = 'ending' AND NOT $status IN ['ended', 'failed'] THEN s.status
               ELSE $status
             END,
             s.errorCode = CASE WHEN $status = 'failed' THEN $errorCode ELSE s.errorCode END,
             s.updatedAt = $now,
             d.processedAt = $now
       )
       REMOVE d.freshToken
       RETURN fresh`,
      {
        botId: value.data.bot.id,
        sessionId,
        eventId,
        freshToken,
        status,
        errorCode: value.data.data.code || value.data.data.sub_code || null,
        now,
      },
    );
    if (!result.records.length) return { knownSession: false, ignored: false, duplicate: false };
    return { knownSession: true, ignored: false, duplicate: !result.records[0].get("fresh") };
  });
}
