import "server-only";

import { randomUUID } from "node:crypto";
import neo4j, { type ManagedTransaction, type Record as Neo4jRecord } from "neo4j-driver";
import { z } from "zod";
import type { AssistanceRequest, Evidence } from "@/lib/contracts";
import { readQuery, writeQuery } from "./db";
import { allowedVoice, elevenLabsVoices } from "./env";

const factKindSchema = z.enum(["decision", "dependency", "deadline", "responsibility", "note"]);

export const profileInputSchema = z.object({
  role: z.string().trim().max(120),
  priorities: z.string().trim().max(2_000),
  tone: z.string().trim().max(500),
  responseExamples: z.string().trim().max(4_000),
  selectedVoiceId: z.string().refine((id) => Boolean(allowedVoice(id)), "Choose an available voice"),
});

const projectInputSchema = z.object({
  kind: z.literal("project"),
  name: z.string().trim().min(1).max(120),
});

const sourceFields = {
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(20_000),
  occurredAt: z.string().datetime().nullable().optional(),
  allowMeetingUse: z.boolean().default(false),
};

const factFields = {
  projectId: z.string().uuid(),
  factKind: factKindSchema,
  text: z.string().trim().min(1).max(2_000),
  sourceIds: z.array(z.string().uuid()).min(1).max(10),
  ownerName: z.string().trim().max(120).nullable().optional(),
  dependsOnFactIds: z.array(z.string().uuid()).max(10).default([]),
};

export const createMemoryInputSchema = z.discriminatedUnion("kind", [
  projectInputSchema,
  z.object({ kind: z.literal("source"), ...sourceFields }),
  z.object({ kind: z.literal("fact"), ...factFields }),
]);

export const updateMemoryInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: z.string().uuid(), name: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal("source"), id: z.string().uuid(), ...sourceFields }),
  z.object({ kind: z.literal("fact"), id: z.string().uuid(), ...factFields }),
]);

export const deleteMemoryInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source"), id: z.string().uuid() }),
  z.object({ kind: z.literal("fact"), id: z.string().uuid() }),
]);

export type Profile = z.infer<typeof profileInputSchema>;
export type CreateMemoryInput = z.infer<typeof createMemoryInputSchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemoryInputSchema>;
export type DeleteMemoryInput = z.infer<typeof deleteMemoryInputSchema>;

export class MemoryInputError extends Error {}

const string = (record: Neo4jRecord, key: string) => String(record.get(key) ?? "");
const number = (value: unknown) => (neo4j.isInt(value) ? value.toNumber() : Number(value));

export async function getProfile(ownerId: string): Promise<Profile> {
  const defaultVoiceId = elevenLabsVoices()[0].id;
  return readQuery(async (tx) => {
    const result = await tx.run(
      `OPTIONAL MATCH (u:User {id: $ownerId})
       RETURN coalesce(u.role, '') AS role,
              coalesce(u.priorities, '') AS priorities,
              coalesce(u.tone, '') AS tone,
              coalesce(u.responseExamples, '') AS responseExamples,
              coalesce(u.selectedVoiceId, $defaultVoiceId) AS selectedVoiceId`,
      { ownerId, defaultVoiceId },
    );
    const record = result.records[0];
    return {
      role: string(record, "role"),
      priorities: string(record, "priorities"),
      tone: string(record, "tone"),
      responseExamples: string(record, "responseExamples"),
      selectedVoiceId: allowedVoice(string(record, "selectedVoiceId"))?.id ?? defaultVoiceId,
    };
  });
}

export async function updateProfile(ownerId: string, profile: Profile): Promise<Profile> {
  profile = profileInputSchema.parse(profile);
  return writeQuery(async (tx) => {
    const result = await tx.run(
      `MERGE (u:User {id: $ownerId})
       SET u.role = $role,
           u.priorities = $priorities,
           u.tone = $tone,
           u.responseExamples = $responseExamples,
           u.selectedVoiceId = $selectedVoiceId
       RETURN u.role AS role, u.priorities AS priorities, u.tone AS tone,
              u.responseExamples AS responseExamples, u.selectedVoiceId AS selectedVoiceId`,
      { ownerId, ...profile },
    );
    const record = result.records[0];
    return {
      role: string(record, "role"),
      priorities: string(record, "priorities"),
      tone: string(record, "tone"),
      responseExamples: string(record, "responseExamples"),
      selectedVoiceId: string(record, "selectedVoiceId"),
    };
  });
}

export async function listMemory(ownerId: string, projectId?: string) {
  return readQuery(async (tx) => {
    const projectsResult = await tx.run(
      `MATCH (p:Project {ownerId: $ownerId})
       WHERE $projectId IS NULL OR p.id = $projectId
       RETURN p.id AS id, p.name AS name
       ORDER BY toLower(p.name)`,
      { ownerId, projectId: projectId ?? null },
    );
    const sourcesResult = await tx.run(
      `MATCH (s:Source {ownerId: $ownerId})
       WHERE $projectId IS NULL OR s.projectId = $projectId
       RETURN s.id AS id, s.projectId AS projectId, s.title AS title, s.text AS text,
              s.createdAt AS createdAt, s.occurredAt AS occurredAt,
              coalesce(s.allowMeetingUse, false) AS allowMeetingUse
       ORDER BY s.createdAt DESC`,
      { ownerId, projectId: projectId ?? null },
    );
    const factsResult = await tx.run(
      `MATCH (f:Fact {ownerId: $ownerId, status: 'confirmed'})
       WHERE $projectId IS NULL OR f.projectId = $projectId
       OPTIONAL MATCH (f)-[:SUPPORTED_BY]->(s:Source)
       OPTIONAL MATCH (f)-[:OWNED_BY]->(person:Person)
       OPTIONAL MATCH (f)-[:DEPENDS_ON]->(dependency:Fact)
       RETURN f.id AS id, f.projectId AS projectId, f.kind AS kind, f.text AS text,
              f.confirmedAt AS confirmedAt, collect(DISTINCT s.id) AS sourceIds,
              head(collect(DISTINCT person.name)) AS ownerName,
              collect(DISTINCT dependency.id) AS dependsOnFactIds
       ORDER BY f.confirmedAt DESC`,
      { ownerId, projectId: projectId ?? null },
    );

    return {
      projects: projectsResult.records.map((r) => ({ id: string(r, "id"), name: string(r, "name") })),
      sources: sourcesResult.records.map((r) => ({
        id: string(r, "id"),
        projectId: string(r, "projectId"),
        title: string(r, "title"),
        text: string(r, "text"),
        createdAt: string(r, "createdAt"),
        occurredAt: r.get("occurredAt") ? string(r, "occurredAt") : null,
        allowMeetingUse: Boolean(r.get("allowMeetingUse")),
      })),
      facts: factsResult.records.map((r) => ({
        id: string(r, "id"),
        projectId: string(r, "projectId"),
        kind: string(r, "kind"),
        text: string(r, "text"),
        confirmedAt: string(r, "confirmedAt"),
        sourceIds: (r.get("sourceIds") as unknown[]).filter(Boolean).map(String),
        ownerName: r.get("ownerName") ? string(r, "ownerName") : null,
        dependsOnFactIds: (r.get("dependsOnFactIds") as unknown[]).filter(Boolean).map(String),
      })),
    };
  });
}

async function assertFactLinks(
  tx: ManagedTransaction,
  ownerId: string,
  projectId: string,
  sourceIds: string[],
  dependencyIds: string[],
) {
  const result = await tx.run(
    `MATCH (p:Project {id: $projectId, ownerId: $ownerId})
     OPTIONAL MATCH (s:Source {ownerId: $ownerId, projectId: $projectId}) WHERE s.id IN $sourceIds
     WITH p, count(DISTINCT s) AS sourceCount
     OPTIONAL MATCH (d:Fact {ownerId: $ownerId, projectId: $projectId, status: 'confirmed'})
       WHERE d.id IN $dependencyIds
     RETURN sourceCount, count(DISTINCT d) AS dependencyCount`,
    { ownerId, projectId, sourceIds, dependencyIds },
  );
  const record = result.records[0];
  if (!record || number(record.get("sourceCount")) !== sourceIds.length) {
    throw new MemoryInputError("Every supporting source must belong to the selected project.");
  }
  if (number(record.get("dependencyCount")) !== dependencyIds.length) {
    throw new MemoryInputError("Every dependency must be a confirmed fact in the selected project.");
  }
}

async function attachFactLinks(
  tx: ManagedTransaction,
  ownerId: string,
  factId: string,
  sourceIds: string[],
  dependencyIds: string[],
  ownerName?: string | null,
) {
  await tx.run(
    `MATCH (f:Fact {id: $factId, ownerId: $ownerId})
     UNWIND $sourceIds AS sourceId
     MATCH (s:Source {id: sourceId, ownerId: $ownerId})
     MERGE (f)-[:SUPPORTED_BY]->(s)`,
    { ownerId, factId, sourceIds },
  );
  if (dependencyIds.length) {
    await tx.run(
      `MATCH (f:Fact {id: $factId, ownerId: $ownerId})
       UNWIND $dependencyIds AS dependencyId
       MATCH (d:Fact {id: dependencyId, ownerId: $ownerId})
       MERGE (f)-[:DEPENDS_ON]->(d)`,
      { ownerId, factId, dependencyIds },
    );
  }
  if (ownerName) {
    const personId = randomUUID();
    await tx.run(
      `MATCH (f:Fact {id: $factId, ownerId: $ownerId})
       MERGE (person:Person {ownerId: $ownerId, nameKey: toLower($ownerName)})
       ON CREATE SET person.id = $personId, person.name = $ownerName
       MERGE (f)-[:OWNED_BY]->(person)`,
      { ownerId, factId, ownerName, personId },
    );
  }
}

export async function createMemory(ownerId: string, input: CreateMemoryInput) {
  const id = randomUUID();
  const now = new Date().toISOString();
  return writeQuery(async (tx) => {
    if (input.kind === "project") {
      const result = await tx.run(
        `MERGE (u:User {id: $ownerId})
         CREATE (p:Project {id: $id, ownerId: $ownerId, name: $name, createdAt: $now})
         MERGE (u)-[:OWNS]->(p)
         RETURN p.id AS id, p.name AS name`,
        { ownerId, id, name: input.name, now },
      );
      return { kind: input.kind, id: string(result.records[0], "id"), name: input.name };
    }

    if (input.kind === "source") {
      const result = await tx.run(
        `MATCH (p:Project {id: $projectId, ownerId: $ownerId})
         CREATE (s:Source {id: $id, ownerId: $ownerId, projectId: $projectId,
           title: $title, text: $text, createdAt: $now, occurredAt: $occurredAt,
           allowMeetingUse: $allowMeetingUse})
         MERGE (p)-[:HAS_SOURCE]->(s)
         RETURN s.id AS id`,
        { ownerId, id, now, occurredAt: input.occurredAt ?? null, ...input },
      );
      if (!result.records[0]) throw new MemoryInputError("Project not found.");
      return { ...input, id, createdAt: now, occurredAt: input.occurredAt ?? null };
    }

    await assertFactLinks(tx, ownerId, input.projectId, input.sourceIds, input.dependsOnFactIds);
    await tx.run(
      `MATCH (p:Project {id: $projectId, ownerId: $ownerId})
       CREATE (f:Fact {id: $id, ownerId: $ownerId, projectId: $projectId,
         kind: $factKind, text: $text, status: 'confirmed', confirmedAt: $now})
       MERGE (p)-[:HAS_FACT]->(f)`,
      { ownerId, id, now, ...input },
    );
    await attachFactLinks(tx, ownerId, id, input.sourceIds, input.dependsOnFactIds, input.ownerName);
    return { ...input, id, status: "confirmed", confirmedAt: now, ownerName: input.ownerName ?? null };
  });
}

export async function updateMemory(ownerId: string, input: UpdateMemoryInput) {
  return writeQuery(async (tx) => {
    if (input.kind === "project") {
      const result = await tx.run(
        `MATCH (p:Project {id: $id, ownerId: $ownerId}) SET p.name = $name RETURN p.id AS id`,
        { ownerId, ...input },
      );
      if (!result.records[0]) throw new MemoryInputError("Project not found.");
      return input;
    }
    if (input.kind === "source") {
      const result = await tx.run(
        `MATCH (s:Source {id: $id, ownerId: $ownerId, projectId: $projectId})
         SET s.title = $title, s.text = $text, s.occurredAt = $occurredAt,
             s.allowMeetingUse = $allowMeetingUse
         RETURN s.id AS id, s.createdAt AS createdAt`,
        { ownerId, occurredAt: input.occurredAt ?? null, ...input },
      );
      if (!result.records[0]) throw new MemoryInputError("Source not found in that project.");
      return { ...input, occurredAt: input.occurredAt ?? null, createdAt: string(result.records[0], "createdAt") };
    }

    await assertFactLinks(tx, ownerId, input.projectId, input.sourceIds, input.dependsOnFactIds);
    const result = await tx.run(
      `MATCH (f:Fact {id: $id, ownerId: $ownerId, projectId: $projectId, status: 'confirmed'})
       SET f.kind = $factKind, f.text = $text
       WITH f
       OPTIONAL MATCH (f)-[r:SUPPORTED_BY|OWNED_BY|DEPENDS_ON]->()
       DELETE r
       RETURN f.confirmedAt AS confirmedAt`,
      { ownerId, ...input },
    );
    if (!result.records[0]) throw new MemoryInputError("Fact not found in that project.");
    await attachFactLinks(tx, ownerId, input.id, input.sourceIds, input.dependsOnFactIds, input.ownerName);
    return {
      ...input,
      status: "confirmed",
      confirmedAt: string(result.records[0], "confirmedAt"),
      ownerName: input.ownerName ?? null,
    };
  });
}

export async function deleteMemory(ownerId: string, input: DeleteMemoryInput) {
  return writeQuery(async (tx) => {
    if (input.kind === "source") {
      const result = await tx.run(
        `MATCH (s:Source {id: $id, ownerId: $ownerId})
         OPTIONAL MATCH (suggestion:Suggestion {ownerId: $ownerId, status: 'ready'})
         WHERE $id IN suggestion.evidenceIds
         SET suggestion.status = 'failed', suggestion.errorCode = 'EVIDENCE_DELETED'
         WITH s, count(suggestion) AS invalidatedSuggestions
         DETACH DELETE s
         RETURN invalidatedSuggestions`,
        { ownerId, id: input.id },
      );
      if (!result.records[0]) throw new MemoryInputError("Source not found.");
      return { deleted: true, invalidatedSuggestions: number(result.records[0].get("invalidatedSuggestions")) };
    }
    const result = await tx.run(
      `MATCH (f:Fact {id: $id, ownerId: $ownerId}) DETACH DELETE f RETURN count(f) AS deleted`,
      { ownerId, id: input.id },
    );
    if (number(result.records[0]?.get("deleted")) !== 1) throw new MemoryInputError("Fact not found.");
    return { deleted: true, invalidatedSuggestions: 0 };
  });
}

export type SuggestionContext = {
  projectName: string;
  profile: Omit<Profile, "selectedVoiceId">;
  transcriptRevision: number;
  evidence: Evidence[];
  selectedUtteranceIds: string[];
};

export function boundEvidence(evidence: Evidence[], maxCharacters = 12_000) {
  const kept: Evidence[] = [];
  let used = 0;
  for (const item of evidence) {
    const remaining = maxCharacters - used;
    if (remaining <= 0) break;
    const excerpt = item.excerpt.slice(0, remaining);
    if (!excerpt) break;
    kept.push({ ...item, excerpt });
    used += excerpt.length;
  }
  return kept;
}

export async function getSuggestionContext(
  ownerId: string,
  sessionId: string,
  request: AssistanceRequest,
): Promise<SuggestionContext> {
  return readQuery(async (tx) => {
    const sessionResult = await tx.run(
      `MATCH (session:Session {id: $sessionId, ownerId: $ownerId})
       MATCH (project:Project {id: session.projectId, ownerId: $ownerId})
       OPTIONAL MATCH (user:User {id: $ownerId})
       RETURN project.id AS projectId, project.name AS projectName,
              session.transcriptRevision AS transcriptRevision,
              coalesce(user.role, '') AS role, coalesce(user.priorities, '') AS priorities,
              coalesce(user.tone, '') AS tone,
              coalesce(user.responseExamples, '') AS responseExamples`,
      { ownerId, sessionId },
    );
    const session = sessionResult.records[0];
    if (!session) throw new MemoryInputError("Meeting session not found.");

    const transcriptRevision = number(session.get("transcriptRevision"));
    if (request.transcriptRevision > transcriptRevision) {
      throw new MemoryInputError("The requested transcript revision is not available.");
    }

    const utteranceResult = await tx.run(
      `MATCH (utterance:Utterance {sessionId: $sessionId})
       WHERE coalesce(utterance.isBot, false) = false
       RETURN utterance.id AS id, coalesce(utterance.speakerName, 'Unknown speaker') AS speakerName,
              utterance.text AS text, utterance.startMs AS startMs,
              utterance.revision AS revision
       ORDER BY utterance.revision DESC
       LIMIT 40`,
      { sessionId },
    );
    const utteranceRecords = [...utteranceResult.records].reverse();
    const availableUtteranceIds = new Set(utteranceRecords.map((r) => string(r, "id")));
    if (request.selectedUtteranceIds.some((id) => !availableUtteranceIds.has(id))) {
      throw new MemoryInputError("A selected transcript item is no longer in the recent meeting context.");
    }
    const utteranceEvidence: Evidence[] = utteranceRecords.map((r) => ({
      id: string(r, "id"),
      kind: "utterance",
      title: string(r, "speakerName"),
      excerpt: string(r, "text"),
      occurredAt: null,
      factIds: [],
    }));

    const projectId = string(session, "projectId");
    const factResult = await tx.run(
      `MATCH (source:Source {ownerId: $ownerId, projectId: $projectId, allowMeetingUse: true})
       OPTIONAL MATCH (fact:Fact {ownerId: $ownerId, projectId: $projectId, status: 'confirmed'})-[:SUPPORTED_BY]->(source)
       OPTIONAL MATCH (fact)-[:OWNED_BY]->(person:Person)
       OPTIONAL MATCH (fact)-[:DEPENDS_ON]->(dependency:Fact {status: 'confirmed'})
       RETURN source.id AS sourceId, source.title AS sourceTitle,
              substring(source.text, 0, 2000) AS excerpt, source.occurredAt AS occurredAt,
              collect(DISTINCT fact.id) AS factIds,
              collect(DISTINCT person.name) AS owners,
              collect(DISTINCT dependency.text) AS dependencies
       ORDER BY max(fact.confirmedAt) DESC
       LIMIT 20`,
      { ownerId, projectId },
    );
    const sourceEvidence: Evidence[] = factResult.records.map((r) => {
      const owners = (r.get("owners") as unknown[]).filter(Boolean).map(String);
      const dependencies = (r.get("dependencies") as unknown[]).filter(Boolean).map(String);
      const details = [
        owners.length ? `Owner: ${owners.join(", ")}` : "",
        dependencies.length ? `Dependencies: ${dependencies.join("; ")}` : "",
      ].filter(Boolean);
      return {
        id: string(r, "sourceId"),
        kind: "source",
        title: string(r, "sourceTitle"),
        excerpt: [string(r, "excerpt"), ...details].join("\n"),
        occurredAt: r.get("occurredAt") ? string(r, "occurredAt") : null,
        factIds: (r.get("factIds") as unknown[]).filter(Boolean).map(String),
      };
    });

    return {
      projectName: string(session, "projectName"),
      transcriptRevision,
      selectedUtteranceIds: request.selectedUtteranceIds,
      profile: {
        role: string(session, "role"),
        priorities: string(session, "priorities"),
        tone: string(session, "tone"),
        responseExamples: string(session, "responseExamples"),
      },
      evidence: boundEvidence([...sourceEvidence, ...utteranceEvidence]),
    };
  });
}
