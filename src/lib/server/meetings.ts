import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { sessionStateSchema, suggestionDraftSchema, type SessionState, type SpeechState } from "../contracts";
import { readQuery, writeQuery } from "./db";
import { recallConfig } from "./env";
import {
  createRecallBot,
  findRecallBotBySessionId,
  RecallError,
  removeRecallBot,
  retrieveRecallBot,
  type RecallBotSnapshot,
} from "./recall";
import { AuthError } from "./auth";

const ACTIVE_STATUSES = ["joining", "waiting", "listening", "ending", "uncertain"];

const statusEventSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.object({
    data: z.object({
      code: z.string().optional(),
      sub_code: z.string().nullable().optional(),
      updated_at: z.string().datetime({ offset: true }),
    }).passthrough(),
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
    throw new MeetingError("Enter a valid Google Meet or Zoom link", "INVALID_MEETING_URL");
  }
  if (url.protocol !== "https:") {
    throw new MeetingError("Enter a valid Google Meet or Zoom link", "INVALID_MEETING_URL");
  }
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  if (url.hostname === "meet.google.com" && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(path)) {
    return `https://meet.google.com/${path}`;
  }
  if ((url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us")) && /^j\/\d{9,11}$/.test(path)) {
    const password = url.searchParams.get("pwd");
    return `https://${url.hostname}/${path}${password ? `?pwd=${encodeURIComponent(password)}` : ""}`;
  }
  throw new MeetingError("Enter a standard Google Meet or Zoom meeting link", "INVALID_MEETING_URL");
}

const meetingPlatform = (meetingUrl: string) => new URL(meetingUrl).hostname === "meet.google.com" ? "google_meet" : "zoom";

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
          trigger: suggestionProps.trigger ?? "manual",
          whyNow: suggestionProps.whyNow ?? null,
          text: suggestionProps.text,
          evidence: JSON.parse(String(suggestionProps.evidenceJson || "[]")),
          responseTargets: JSON.parse(String(suggestionProps.responseTargetJson || "[]")),
          reasoningPath: JSON.parse(String(suggestionProps.reasoningPathJson || "{\"nodes\":[],\"edges\":[]}")),
          toolCalls: JSON.parse(String(suggestionProps.graphToolCallsJson || "[]")),
          learnedFromCount: asNumber(suggestionProps.learnedFromCount),
          trace: JSON.parse(String(suggestionProps.traceJson || "null")),
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
      meetingPlatform: session.meetingPlatform === "zoom" ? "zoom" : "google_meet",
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
  // The bot can wait minutes in the meeting waiting room before the host admits it and Recall
  // loads the media page; too-short a window leaves the session permanently audio-dead.
  const expiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

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
         meetingPlatform: $meetingPlatform,
         status: 'joining', transcriptRevision: 0, stopRevision: 0,
         floorSpeakerIds: [], floorQuietSince: $now,
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
        meetingPlatform: meetingPlatform(meetingUrl),
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
  const { appBaseUrl } = recallConfig();
  const reserved = await reserveSession(ownerId, meetingUrl, input.projectId);
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
  const known = await readQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})
       RETURN s.providerBotId AS botId, s.status AS status`,
      { sessionId, ownerId },
    );
    if (!result.records.length) throw new MeetingError("Meeting session not found", "SESSION_NOT_FOUND", 404);
    return {
      botId: result.records[0].get("botId") as string | null,
      status: String(result.records[0].get("status")),
    };
  });
  if (known.status === "ended") return getSessionState(ownerId, sessionId);

  let botId = known.botId;
  let providerEnded = false;
  if (!botId && known.status === "uncertain") {
    const bot = await findRecallBotBySessionId(sessionId);
    if (!bot) {
      throw new MeetingError("Recall has not resolved this meeting yet. Try End again shortly.", "RECOVERY_PENDING", 409);
    }
    botId = bot.id;
    providerEnded = latestRecallStatus(bot)?.status === "ended";
  }

  await writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})
       SET s.providerBotId = coalesce(s.providerBotId, $botId),
           s.status = 'ending', s.stopRevision = coalesce(s.stopRevision, 0) + 1,
           s.updatedAt = $now, s.activeSpeechId = null
       WITH s
       OPTIONAL MATCH (c:SpeechCommand {sessionId: s.id})
       WHERE c.status IN ['queued', 'claimed', 'preparing', 'playing']
       SET c.status = 'cancelled', c.updatedAt = $now
       WITH s
       OPTIONAL MATCH (a:AccessSession {scopedSessionId: s.id}) DETACH DELETE a
       RETURN s.id AS id`,
      { sessionId, ownerId, botId, now: new Date().toISOString() },
    );
    if (!result.records.length) throw new MeetingError("Meeting session not found", "SESSION_NOT_FOUND", 404);
  });

  try {
    if (botId && !providerEnded) await removeRecallBot(botId);
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

export function recallStatusFromCode(code: string) {
  const normalized = code.replace(/^bot\./, "");
  if (["ready", "joining_call"].includes(normalized)) return { status: "joining" as const, rank: 0 };
  if (normalized === "in_waiting_room") return { status: "waiting" as const, rank: 1 };
  if (["in_call_not_recording", "recording_permission_allowed", "in_call_recording"].includes(normalized)) {
    return { status: "listening" as const, rank: 2 };
  }
  if (["fatal", "recording_permission_denied"].includes(normalized)) return { status: "failed" as const, rank: 3 };
  if (["call_ended", "done", "recording_done", "analysis_done"].includes(normalized)) return { status: "ended" as const, rank: 4 };
  return null;
}

export function latestRecallStatus(bot: RecallBotSnapshot) {
  const latest = [...bot.statusChanges].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  const mapped = recallStatusFromCode(latest?.code || bot.status || "");
  return mapped ? { ...mapped, updatedAt: latest?.createdAt || new Date().toISOString(), errorCode: latest?.subCode || null } : null;
}

export type MeetingSummary = {
  id: string;
  projectId: string;
  projectName: string;
  meetingPlatform: "google_meet" | "zoom";
  status: SessionState["status"];
  createdAt: string;
  updatedAt: string;
  transcriptCount: number;
  reviewState: "none" | "pending" | "complete";
};

export function reviewStateForMeeting(
  status: SessionState["status"],
  transcriptCount: number,
  extractionStatus: string,
  pendingReviewCount: number,
): MeetingSummary["reviewState"] {
  if (status !== "ended" || transcriptCount === 0) return "none";
  return extractionStatus === "ready" && pendingReviewCount === 0 ? "complete" : "pending";
}

export async function listMeetingSessions(ownerId: string): Promise<MeetingSummary[]> {
  return readQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session {ownerId: $ownerId})
       WHERE s.status IN ['joining', 'waiting', 'listening', 'ending', 'uncertain', 'ended']
       OPTIONAL MATCH (p:Project {id: s.projectId, ownerId: $ownerId})
       CALL (s) {
         OPTIONAL MATCH (s)-[:HAS_UTTERANCE]->(u:Utterance)
         RETURN count(u) AS transcriptCount
       }
       CALL (s) {
         OPTIONAL MATCH (s)-[:HAS_REVIEW_CANDIDATE]->(candidate:ReviewCandidate {status: 'pending'})
         RETURN count(candidate) AS pendingReviewCount
       }
       RETURN s.id AS id, s.projectId AS projectId, coalesce(p.name, 'General') AS projectName,
              coalesce(s.meetingPlatform, 'google_meet') AS meetingPlatform, s.status AS status,
              s.createdAt AS createdAt, s.updatedAt AS updatedAt,
              transcriptCount, pendingReviewCount,
              coalesce(s.reviewExtractionStatus, '') AS extractionStatus
       ORDER BY s.createdAt DESC LIMIT 12`,
      { ownerId },
    );
    return result.records.map((record) => {
      const status = record.get("status") as SessionState["status"];
      const transcriptCount = asNumber(record.get("transcriptCount"));
      return {
        id: String(record.get("id")),
        projectId: String(record.get("projectId")),
        projectName: String(record.get("projectName")),
        meetingPlatform: record.get("meetingPlatform") === "zoom" ? "zoom" : "google_meet",
        status,
        createdAt: String(record.get("createdAt")),
        updatedAt: String(record.get("updatedAt")),
        transcriptCount,
        reviewState: reviewStateForMeeting(
          status,
          transcriptCount,
          String(record.get("extractionStatus")),
          asNumber(record.get("pendingReviewCount")),
        ),
      };
    });
  });
}

export async function recoverMeeting(ownerId: string, sessionId: string) {
  const session = await readQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})
       RETURN s.providerBotId AS providerBotId, s.status AS status`,
      { sessionId, ownerId },
    );
    if (!result.records.length) throw new MeetingError("Meeting session not found", "SESSION_NOT_FOUND", 404);
    return {
      providerBotId: result.records[0].get("providerBotId") as string | null,
      status: String(result.records[0].get("status")),
    };
  });
  if (!["joining", "waiting", "listening", "ending", "uncertain"].includes(session.status)) {
    return getSessionState(ownerId, sessionId);
  }

  let bot: RecallBotSnapshot | null = null;
  if (session.providerBotId) {
    try {
      bot = await retrieveRecallBot(session.providerBotId);
    } catch (error) {
      if (!(error instanceof RecallError) || error.code !== "RECALL_REJECTED") throw error;
    }
  }
  bot ??= await findRecallBotBySessionId(sessionId);
  if (!bot) {
    throw new MeetingError("No meeting bot was found. End this session before starting another.", "RECOVERY_NOT_FOUND", 409);
  }
  const provider = latestRecallStatus(bot);
  if (!provider) throw new MeetingError("Recall has not reported a usable meeting state yet", "RECOVERY_PENDING", 409);

  await writeQuery(async (tx) => {
    await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})
       SET s.providerBotId = $botId, s.status = $status, s.providerStatusRank = $rank,
           s.providerStatusUpdatedAt = datetime($providerUpdatedAt), s.errorCode = $errorCode,
           s.updatedAt = $now
       WITH s
       OPTIONAL MATCH (a:AccessSession {scopedSessionId: s.id})
       FOREACH (_ IN CASE WHEN $terminal AND a IS NOT NULL THEN [1] ELSE [] END | DETACH DELETE a)
       WITH s
       OPTIONAL MATCH (c:SpeechCommand {sessionId: s.id})
       WHERE $terminal AND c.status IN ['queued', 'claimed', 'preparing', 'playing']
       SET c.status = 'cancelled', c.updatedAt = $now, s.activeSpeechId = null`,
      {
        ownerId,
        sessionId,
        botId: bot.id,
        status: provider.status,
        rank: provider.rank,
        providerUpdatedAt: provider.updatedAt,
        errorCode: provider.errorCode,
        terminal: ["ended", "failed"].includes(provider.status),
        now: new Date().toISOString(),
      },
    );
  });
  return getSessionState(ownerId, sessionId);
}

export async function applyRecallStatus(eventId: string, value: z.infer<typeof statusEventSchema>) {
  const providerState = recallStatusFromCode(value.event);
  if (!providerState) return { knownSession: false, ignored: true, duplicate: false };

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
       WITH s, d, d.freshToken = $freshToken AS fresh, datetime($providerUpdatedAt) AS providerUpdatedAt
       WITH s, d, fresh, providerUpdatedAt,
            fresh AND (s.providerStatusUpdatedAt IS NULL OR providerUpdatedAt > s.providerStatusUpdatedAt
              OR (providerUpdatedAt = s.providerStatusUpdatedAt AND $statusRank >= coalesce(s.providerStatusRank, -1))) AS apply
       FOREACH (_ IN CASE WHEN fresh THEN [1] ELSE [] END | SET d.processedAt = $now)
       FOREACH (_ IN CASE WHEN apply THEN [1] ELSE [] END |
         SET s.providerBotId = coalesce(s.providerBotId, $botId),
             s.status = CASE
               WHEN s.status = 'ended' THEN 'ended'
               WHEN s.status = 'ending' AND NOT $status IN ['ended', 'failed'] THEN s.status
               ELSE $status
             END,
             s.providerStatusUpdatedAt = providerUpdatedAt,
             s.providerStatusRank = $statusRank,
             s.errorCode = CASE WHEN $status = 'failed' THEN $errorCode ELSE s.errorCode END,
             s.updatedAt = $now
       )
       REMOVE d.freshToken
       RETURN fresh`,
      {
        botId: value.data.bot.id,
        sessionId,
        eventId,
        freshToken,
        status: providerState.status,
        statusRank: providerState.rank,
        providerUpdatedAt: value.data.data.updated_at,
        errorCode: value.data.data.code || value.data.data.sub_code || null,
        now,
      },
    );
    if (!result.records.length) return { knownSession: false, ignored: false, duplicate: false };
    return { knownSession: true, ignored: false, duplicate: !result.records[0].get("fresh") };
  });
}
