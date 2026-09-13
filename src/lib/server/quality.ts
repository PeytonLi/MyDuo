import "server-only";

import neo4j, { type Record as Neo4jRecord } from "neo4j-driver";
import { normalizedEditDistance } from "./evaluation";
import { readQuery } from "./db";

export type QualityDashboard = {
  tracedDrafts: number;
  completionRate: number;
  groundedRate: number;
  approvalRate: number;
  averageEditDistance: number;
  averageGraphHops: number;
  generationP50Ms: number | null;
  generationP95Ms: number | null;
  approvalToAudioP50Ms: number | null;
  approvalToAudioP95Ms: number | null;
};

const number = (value: unknown) => neo4j.isInt(value) ? value.toNumber() : Number(value ?? 0);
const ratio = (part: number, whole: number) => whole ? part / whole : 0;

function percentile(values: number[], value: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(value * sorted.length) - 1];
}

function parseArray(value: unknown) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getQualityDashboard(ownerId: string): Promise<QualityDashboard> {
  return readQuery(async (tx) => {
    const traceResult = await tx.run(
      `MATCH (trace:GenerationTrace {ownerId: $ownerId})
       OPTIONAL MATCH (suggestion:Suggestion {id: trace.suggestionId, ownerId: $ownerId})
       RETURN trace.status AS status, trace.totalMs AS totalMs,
              trace.evidenceIds AS evidenceIds, trace.reasoningPathJson AS reasoningPathJson,
              suggestion.generatedText AS generatedText, suggestion.approvedText AS approvedText
       ORDER BY trace.createdAt DESC LIMIT 100`,
      { ownerId },
    );
    const traces = traceResult.records;
    const completed = traces.filter((record) => record.get("status") === "completed");
    const grounded = completed.filter((record) => parseArray(record.get("evidenceIds")).length > 0);
    const generationTimes = completed.map((record) => number(record.get("totalMs"))).filter((value) => value > 0);
    const approved = completed.filter((record) => typeof record.get("approvedText") === "string");
    const edits = approved.map((record) => normalizedEditDistance(String(record.get("generatedText") ?? ""), String(record.get("approvedText"))));
    const graphHops = completed.map((record) => {
      try {
        const path = JSON.parse(String(record.get("reasoningPathJson") || "{}")) as { edges?: unknown[] };
        return Array.isArray(path.edges) ? path.edges.length : 0;
      } catch {
        return 0;
      }
    });

    const speechResult = await tx.run(
      `MATCH (session:Session {ownerId: $ownerId})
       MATCH (command:SpeechCommand {sessionId: session.id})
       WHERE command.playingAt IS NOT NULL
       RETURN command.createdAt AS approvedAt, command.playingAt AS playingAt
       ORDER BY command.playingAt DESC LIMIT 100`,
      { ownerId },
    );
    const speechTimes = speechResult.records.map((record: Neo4jRecord) => (
      Date.parse(String(record.get("playingAt"))) - Date.parse(String(record.get("approvedAt")))
    )).filter((value: number) => Number.isFinite(value) && value >= 0);

    return {
      tracedDrafts: traces.length,
      completionRate: ratio(completed.length, traces.length),
      groundedRate: ratio(grounded.length, completed.length),
      approvalRate: ratio(approved.length, completed.length),
      averageEditDistance: ratio(edits.reduce((total, value) => total + value, 0), edits.length),
      averageGraphHops: ratio(graphHops.reduce((total, value) => total + value, 0), graphHops.length),
      generationP50Ms: percentile(generationTimes, 0.5),
      generationP95Ms: percentile(generationTimes, 0.95),
      approvalToAudioP50Ms: percentile(speechTimes, 0.5),
      approvalToAudioP95Ms: percentile(speechTimes, 0.95),
    };
  });
}
