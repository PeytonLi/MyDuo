import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeQuery } from "./db";

const wordSchema = z.object({
  text: z.string().min(1).max(500),
  start_timestamp: z.object({ relative: z.number().nonnegative() }),
  end_timestamp: z.object({ relative: z.number().nonnegative() }).nullable(),
});

const transcriptEventSchema = z.object({
  event: z.literal("transcript.data"),
  data: z.object({
    data: z.object({
      words: z.array(wordSchema).min(1).max(2_000),
      participant: z.object({
        id: z.union([z.string(), z.number()]),
        name: z.string().max(120).nullable(),
      }),
    }),
    transcript: z.object({ id: z.string().min(1) }),
    bot: z.object({ id: z.string().min(1) }),
  }),
});

const participantSpeechEventSchema = z.object({
  event: z.enum(["participant_events.speech_on", "participant_events.speech_off"]),
  data: z.object({
    data: z.object({
      participant: z.object({
        id: z.union([z.string(), z.number()]),
        name: z.string().max(120).nullable(),
      }).passthrough(),
      timestamp: z.object({
        absolute: z.string().datetime({ offset: true }),
        relative: z.number().nonnegative(),
      }),
    }).passthrough(),
    bot: z.object({ id: z.string().min(1) }).passthrough(),
  }).passthrough(),
});

export type TranscriptEvent = z.infer<typeof transcriptEventSchema>;
export type ParticipantSpeechEvent = z.infer<typeof participantSpeechEventSchema>;

const asNumber = (value: unknown) =>
  value && typeof value === "object" && "toNumber" in value
    ? (value as { toNumber(): number }).toNumber()
    : Number(value ?? 0);

export function parseTranscriptEvent(value: unknown) {
  return transcriptEventSchema.parse(value);
}

export function parseParticipantSpeechEvent(value: unknown) {
  return participantSpeechEventSchema.parse(value);
}

export function normalizeTranscriptEvent(event: TranscriptEvent) {
  const { words, participant } = event.data.data;
  const text = words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
  if (!text) throw new Error("Transcript contained no text");

  const startMs = Math.round(words[0].start_timestamp.relative * 1_000);
  const last = words.at(-1)!;
  const endMs = Math.max(startMs, Math.round((last.end_timestamp?.relative ?? last.start_timestamp.relative) * 1_000));
  const speakerName = participant.name?.trim() || "Unknown speaker";
  return {
    providerBotId: event.data.bot.id,
    providerTranscriptId: event.data.transcript.id,
    speakerId: String(participant.id),
    speakerName,
    text,
    startMs,
    endMs,
    isBot: speakerName.toLowerCase() === "myduo",
  };
}

export async function ingestTranscript(eventId: string, event: TranscriptEvent) {
  const turn = normalizeTranscriptEvent(event);
  const id = randomUUID();
  const freshToken = randomUUID();
  const now = new Date().toISOString();

  return writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session {providerBotId: $providerBotId})
       MERGE (d:RecallDelivery {id: $eventId})
       ON CREATE SET d.createdAt = $now, d.freshToken = $freshToken
       WITH s, d, d.freshToken = $freshToken AS fresh,
            coalesce(s.transcriptRevision, 0) + 1 AS nextRevision
       FOREACH (_ IN CASE WHEN fresh THEN [1] ELSE [] END |
         SET s.transcriptRevision = nextRevision,
             s.updatedAt = $now,
             s.status = CASE WHEN s.status IN ['joining', 'waiting'] THEN 'listening' ELSE s.status END,
             d.processedAt = $now
         CREATE (u:Utterance {
           id: $id,
           sessionId: s.id,
           providerEventId: $eventId,
           providerTranscriptId: $providerTranscriptId,
           speakerId: $speakerId,
           speakerName: $speakerName,
           text: $text,
           startMs: $startMs,
           endMs: $endMs,
           revision: nextRevision,
           isBot: $isBot,
           createdAt: $now
         })
         CREATE (s)-[:HAS_UTTERANCE]->(u)
       )
       REMOVE d.freshToken
       RETURN s.id AS sessionId, fresh`,
      { ...turn, id, eventId, freshToken, now },
    );
    if (!result.records.length) return { knownSession: false, duplicate: false };
    return {
      knownSession: true,
      duplicate: !result.records[0].get("fresh"),
    };
  });
}

export async function ingestParticipantSpeech(eventId: string, event: ParticipantSpeechEvent) {
  const participantId = String(event.data.data.participant.id);
  const participantName = event.data.data.participant.name?.trim() || "Unknown speaker";
  const speaking = event.event === "participant_events.speech_on";
  const isBot = participantName.toLowerCase() === "myduo";
  const freshToken = randomUUID();
  const now = new Date().toISOString();

  return writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session {providerBotId: $providerBotId})
       MERGE (d:RecallDelivery {id: $eventId})
       ON CREATE SET d.createdAt = $now, d.freshToken = $freshToken
       WITH s, d, d.freshToken = $freshToken AS fresh,
            coalesce(s.floorSpeakerIds, []) AS currentSpeakerIds
       WITH s, d, fresh,
            CASE
              WHEN NOT fresh OR $isBot THEN currentSpeakerIds
              WHEN $speaking AND NOT $participantId IN currentSpeakerIds THEN currentSpeakerIds + $participantId
              WHEN NOT $speaking THEN [id IN currentSpeakerIds WHERE id <> $participantId]
              ELSE currentSpeakerIds
            END AS nextSpeakerIds
       FOREACH (_ IN CASE WHEN fresh THEN [1] ELSE [] END | SET d.processedAt = $now)
       FOREACH (_ IN CASE WHEN fresh AND NOT $isBot THEN [1] ELSE [] END |
         SET s.floorSpeakerIds = nextSpeakerIds,
             s.floorQuietSince = CASE WHEN size(nextSpeakerIds) = 0 THEN $occurredAt ELSE null END,
             s.updatedAt = $now
       )
       REMOVE d.freshToken
       RETURN s.id AS sessionId, fresh, size(nextSpeakerIds) AS speakingCount`,
      {
        providerBotId: event.data.bot.id,
        eventId,
        freshToken,
        participantId,
        speaking,
        isBot,
        occurredAt: event.data.data.timestamp.absolute,
        now,
      },
    );
    if (!result.records.length) return { knownSession: false, duplicate: false, speakingCount: 0 };
    return {
      knownSession: true,
      duplicate: !result.records[0].get("fresh"),
      speakingCount: asNumber(result.records[0].get("speakingCount")),
    };
  });
}
