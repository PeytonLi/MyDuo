import "server-only";

import { randomUUID } from "node:crypto";
import neo4j, { type ManagedTransaction, type Record as Neo4jRecord } from "neo4j-driver";
import { z } from "zod";
import type { AssistanceRequest, Evidence, ReasoningPath, ResponseTarget } from "@/lib/contracts";
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
         kind: $factKind, text: $text, status: 'confirmed', confirmedAt: $now,
         validFrom: $now, validTo: null})
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
       SET f.kind = $factKind, f.text = $text, f.validFrom = coalesce(f.validFrom, f.confirmedAt)
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
  projectId: string;
  projectName: string;
  profile: Omit<Profile, "selectedVoiceId">;
  transcriptRevision: number;
  evidence: Evidence[];
  selectedUtteranceIds: string[];
  responseTargets: ResponseTarget[];
  learnedEdits: { draft: string; approved: string }[];
  contextTerms: string[];
};

const ignoredSearchTerms = new Set([
  "about", "after", "again", "could", "does", "for", "from", "have", "help", "into", "just", "meeting", "should", "that",
  "their", "there", "these", "they", "this", "what", "when", "where", "which", "with", "would", "your",
]);

export function graphSearchTerms(text: string) {
  return [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [])]
    .filter((term) => !ignoredSearchTerms.has(term))
    .slice(0, 12);
}

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

export const graphToolNames = [
  "search_project_knowledge",
  "trace_dependencies",
  "find_conflicts",
  "get_owners_and_deadlines",
] as const;

export type GraphToolName = (typeof graphToolNames)[number];
export type GraphToolInput =
  | { name: "search_project_knowledge"; query: string; limit: number }
  | { name: "trace_dependencies"; factIds: string[]; depth: number }
  | { name: "find_conflicts"; factIds: string[] }
  | { name: "get_owners_and_deadlines"; factIds: string[] };

export type GraphToolResult = {
  facts: { id: string; kind: string; text: string; owners: string[]; sourceIds: string[] }[];
  evidence: Evidence[];
  reasoningPath: ReasoningPath;
  resultCount: number;
};

const graphFactIdsSchema = z.array(z.string().uuid()).min(1).max(8);
const graphToolArgumentSchemas = {
  search_project_knowledge: z.object({
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(8).default(5),
  }).strict(),
  trace_dependencies: z.object({ factIds: graphFactIdsSchema, depth: z.number().int().min(1).max(3).default(3) }).strict(),
  find_conflicts: z.object({ factIds: graphFactIdsSchema }).strict(),
  get_owners_and_deadlines: z.object({ factIds: graphFactIdsSchema }).strict(),
} satisfies Record<GraphToolName, z.ZodType>;

export function parseGraphToolCall(name: string, rawArguments: string): GraphToolInput {
  if (!graphToolNames.includes(name as GraphToolName)) throw new MemoryInputError("DeepSeek requested an unknown graph tool.");
  let value: unknown;
  try {
    value = JSON.parse(rawArguments);
  } catch {
    throw new MemoryInputError("DeepSeek supplied invalid graph tool arguments.");
  }
  const toolName = name as GraphToolName;
  return { name: toolName, ...graphToolArgumentSchemas[toolName].parse(value) } as GraphToolInput;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function factBundle(
  tx: ManagedTransaction,
  ownerId: string,
  projectId: string,
  factIds: string[],
): Promise<Omit<GraphToolResult, "resultCount">> {
  if (!factIds.length) return { facts: [], evidence: [], reasoningPath: { nodes: [], edges: [] } };
  const result = await tx.run(
    `UNWIND $factIds AS factId
     MATCH (fact:Fact {id: factId, ownerId: $ownerId, projectId: $projectId, status: 'confirmed'})
     OPTIONAL MATCH (fact)-[:OWNED_BY]->(person:Person)
     WITH fact, collect(DISTINCT person { .id, .name }) AS people
     OPTIONAL MATCH (fact)-[:SUPPORTED_BY]->(source:Source {allowMeetingUse: true})
     RETURN fact.id AS factId, fact.kind AS factKind, fact.text AS factText,
            people, collect(DISTINCT source { .id, .title, .text, .occurredAt }) AS sources`,
    { ownerId, projectId, factIds },
  );
  const facts: GraphToolResult["facts"] = [];
  const nodes = new Map<string, ReasoningPath["nodes"][number]>();
  const edges = new Map<string, ReasoningPath["edges"][number]>();
  const sources = new Map<string, Evidence>();

  for (const record of result.records) {
    const factId = string(record, "factId");
    const factText = string(record, "factText");
    const people = (record.get("people") as unknown[]).map(asObject).filter((person) => person.id);
    const factSources = (record.get("sources") as unknown[]).map(asObject).filter((source) => source.id);
    facts.push({
      id: factId,
      kind: string(record, "factKind"),
      text: factText,
      owners: people.map((person) => String(person.name)),
      sourceIds: factSources.map((source) => String(source.id)),
    });
    nodes.set(factId, { id: factId, kind: "fact", label: factText });
    for (const person of people) {
      const personId = String(person.id);
      nodes.set(personId, { id: personId, kind: "person", label: String(person.name) });
      edges.set(`${factId}:OWNED_BY:${personId}`, { from: factId, to: personId, type: "OWNED_BY" });
    }
    for (const source of factSources) {
      const sourceId = String(source.id);
      nodes.set(sourceId, { id: sourceId, kind: "source", label: String(source.title) });
      edges.set(`${factId}:SUPPORTED_BY:${sourceId}`, { from: factId, to: sourceId, type: "SUPPORTED_BY" });
      const existing = sources.get(sourceId);
      sources.set(sourceId, {
        id: sourceId,
        kind: "source",
        title: String(source.title),
        excerpt: String(source.text).slice(0, 2_000),
        occurredAt: source.occurredAt ? String(source.occurredAt) : null,
        factIds: [...new Set([...(existing?.factIds ?? []), factId])],
      });
    }
  }

  const dependencyResult = await tx.run(
    `MATCH (from:Fact {ownerId: $ownerId, projectId: $projectId})-[:DEPENDS_ON]->
           (to:Fact {ownerId: $ownerId, projectId: $projectId})
     WHERE from.id IN $factIds AND to.id IN $factIds
     RETURN from.id AS fromId, to.id AS toId`,
    { ownerId, projectId, factIds },
  );
  for (const record of dependencyResult.records) {
    const from = string(record, "fromId");
    const to = string(record, "toId");
    edges.set(`${from}:DEPENDS_ON:${to}`, { from, to, type: "DEPENDS_ON" });
  }

  return { facts, evidence: [...sources.values()], reasoningPath: { nodes: [...nodes.values()], edges: [...edges.values()] } };
}

export async function executeGraphTool(ownerId: string, projectId: string, input: GraphToolInput): Promise<GraphToolResult> {
  return readQuery(async (tx) => {
    let factIds: string[] = [];
    let extraEdges: ReasoningPath["edges"] = [];
    if (input.name === "search_project_knowledge") {
      const terms = graphSearchTerms(input.query);
      if (!terms.length) return { facts: [], evidence: [], reasoningPath: { nodes: [], edges: [] }, resultCount: 0 };
      const index = await tx.run(
        "SHOW FULLTEXT INDEXES YIELD name WHERE name = 'myduo_fact_text' RETURN count(*) AS count",
      );
      const hasFullTextIndex = number(index.records[0]?.get("count")) > 0;
      const result = hasFullTextIndex
        ? await tx.run(
          `CALL db.index.fulltext.queryNodes('myduo_fact_text', $fullTextQuery, {limit: 50})
           YIELD node AS fact, score
           WHERE fact.ownerId = $ownerId AND fact.projectId = $projectId AND fact.status = 'confirmed'
             AND EXISTS { MATCH (fact)-[:SUPPORTED_BY]->(:Source {allowMeetingUse: true}) }
           RETURN fact.id AS id ORDER BY score DESC, fact.confirmedAt DESC LIMIT $limit`,
          {
            ownerId,
            projectId,
            fullTextQuery: terms.map((term) => term.replace(/[^a-z0-9]/g, "")).filter(Boolean).join(" OR "),
            limit: neo4j.int(input.limit),
          },
        )
        : await tx.run(
          `MATCH (fact:Fact {ownerId: $ownerId, projectId: $projectId, status: 'confirmed'})
           WHERE any(term IN $terms WHERE toLower(fact.text) CONTAINS term)
             AND EXISTS { MATCH (fact)-[:SUPPORTED_BY]->(:Source {allowMeetingUse: true}) }
           WITH fact, size([term IN $terms WHERE toLower(fact.text) CONTAINS term]) AS score
           RETURN fact.id AS id ORDER BY score DESC, fact.confirmedAt DESC LIMIT $limit`,
          { ownerId, projectId, terms, limit: neo4j.int(input.limit) },
        );
      factIds = result.records.map((record) => string(record, "id"));
    } else if (input.name === "trace_dependencies") {
      const upstream = await tx.run(
          `UNWIND $factIds AS factId
           MATCH path=(start:Fact {id: factId, ownerId: $ownerId, projectId: $projectId})-[:DEPENDS_ON*1..3]->
                      (related:Fact {ownerId: $ownerId, projectId: $projectId, status: 'confirmed'})
           WHERE length(path) <= $depth
           UNWIND nodes(path) AS fact RETURN DISTINCT fact.id AS id LIMIT 40`,
          { ownerId, projectId, factIds: input.factIds, depth: neo4j.int(input.depth) },
        );
      const downstream = await tx.run(
          `UNWIND $factIds AS factId
           MATCH path=(related:Fact {ownerId: $ownerId, projectId: $projectId, status: 'confirmed'})-[:DEPENDS_ON*1..3]->
                      (start:Fact {id: factId, ownerId: $ownerId, projectId: $projectId})
           WHERE length(path) <= $depth
           UNWIND nodes(path) AS fact RETURN DISTINCT fact.id AS id LIMIT 40`,
          { ownerId, projectId, factIds: input.factIds, depth: neo4j.int(input.depth) },
        );
      factIds = [...new Set([...input.factIds, ...upstream.records.map((r) => string(r, "id")), ...downstream.records.map((r) => string(r, "id"))])].slice(0, 40);
    } else if (input.name === "find_conflicts") {
      const outgoing = await tx.run(
        `UNWIND $factIds AS factId
         MATCH (fact:Fact {id: factId, ownerId: $ownerId, projectId: $projectId})
         MATCH (fact)-[relationship:CONTRADICTS|SUPERSEDES]->(other:Fact {ownerId: $ownerId, projectId: $projectId})
         RETURN DISTINCT fact.id AS fromId, other.id AS toId, type(relationship) AS relationshipType`,
        { ownerId, projectId, factIds: input.factIds },
      );
      const incoming = await tx.run(
        `UNWIND $factIds AS factId
         MATCH (fact:Fact {id: factId, ownerId: $ownerId, projectId: $projectId})
         MATCH (other:Fact {ownerId: $ownerId, projectId: $projectId})-
               [relationship:CONTRADICTS|SUPERSEDES]->(fact)
         RETURN DISTINCT other.id AS fromId, fact.id AS toId, type(relationship) AS relationshipType`,
        { ownerId, projectId, factIds: input.factIds },
      );
      const conflictRecords = [...outgoing.records, ...incoming.records];
      factIds = [...new Set([...input.factIds, ...conflictRecords.flatMap((record) => [string(record, "fromId"), string(record, "toId")])])];
      extraEdges = conflictRecords.map((record) => ({
        from: string(record, "fromId"),
        to: string(record, "toId"),
        type: string(record, "relationshipType") as "CONTRADICTS" | "SUPERSEDES",
      }));
    } else {
      const result = await tx.run(
        `UNWIND $factIds AS factId
         MATCH (fact:Fact {id: factId, ownerId: $ownerId, projectId: $projectId})
         OPTIONAL MATCH (fact)-[:DEPENDS_ON*1..2]-(related:Fact {ownerId: $ownerId, projectId: $projectId, status: 'confirmed'})
         WITH collect(fact) + collect(related) AS candidates
         UNWIND candidates AS candidate
         WITH DISTINCT candidate WHERE candidate IS NOT NULL AND (candidate.kind = 'deadline' OR candidate.id IN $factIds)
         RETURN candidate.id AS id LIMIT 30`,
        { ownerId, projectId, factIds: input.factIds },
      );
      factIds = result.records.map((record) => string(record, "id"));
    }

    const bundle = await factBundle(tx, ownerId, projectId, factIds);
    const edgeMap = new Map(bundle.reasoningPath.edges.map((edge) => [`${edge.from}:${edge.type}:${edge.to}`, edge]));
    for (const edge of extraEdges) edgeMap.set(`${edge.from}:${edge.type}:${edge.to}`, edge);
    return {
      ...bundle,
      reasoningPath: { ...bundle.reasoningPath, edges: [...edgeMap.values()] },
      resultCount: input.name === "find_conflicts" ? extraEdges.length : bundle.facts.length,
    };
  });
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
    const utteranceTargets = utteranceRecords.map((r) => ({
      id: string(r, "id"),
      speakerName: string(r, "speakerName"),
      text: string(r, "text"),
    }));
    const selectedTargetIds = new Set(request.selectedUtteranceIds);
    const responseTargets = request.selectedUtteranceIds.length
      ? utteranceTargets.filter((item) => selectedTargetIds.has(item.id))
      : utteranceTargets.slice(-1);

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

    const contextTerms = graphSearchTerms(responseTargets.map((target) => target.text).join(" "));
    const editResult = await tx.run(
      `MATCH (suggestion:Suggestion {ownerId: $ownerId, status: 'approved'})
       MATCH (priorSession:Session {id: suggestion.sessionId, ownerId: $ownerId, projectId: $projectId})
       WHERE suggestion.generatedText IS NOT NULL
         AND suggestion.approvedText IS NOT NULL
         AND suggestion.generatedText <> suggestion.approvedText
         AND (suggestion.mode = $mode OR suggestion.mode IS NULL)
       WITH suggestion,
            size([term IN coalesce(suggestion.contextTerms, []) WHERE term IN $contextTerms]) AS contextOverlap
       RETURN suggestion.generatedText AS draft, suggestion.approvedText AS approved
       ORDER BY contextOverlap DESC, suggestion.approvedAt DESC
       LIMIT 3`,
      { ownerId, projectId, mode: request.mode, contextTerms },
    );

    return {
      projectId,
      projectName: string(session, "projectName"),
      transcriptRevision,
      selectedUtteranceIds: request.selectedUtteranceIds,
      responseTargets,
      learnedEdits: editResult.records.map((record) => ({
        draft: string(record, "draft"),
        approved: string(record, "approved"),
      })),
      contextTerms,
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
