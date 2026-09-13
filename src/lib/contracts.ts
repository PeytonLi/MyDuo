import { z } from "zod";

export const idSchema = z.string().uuid();

export const transcriptTurnSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  speakerId: z.string().nullable(),
  speakerName: z.string().min(1).max(120),
  text: z.string().min(1).max(5_000),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  isBot: z.boolean(),
});

export const evidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["source", "utterance"]),
  title: z.string().min(1).max(200),
  excerpt: z.string().min(1).max(2_000),
  occurredAt: z.string().nullable(),
  factIds: z.array(z.string()),
});

export const responseTargetSchema = z.object({
  id: idSchema,
  speakerName: z.string().min(1).max(120),
  text: z.string().min(1).max(5_000),
});

export const reasoningNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["fact", "source", "person"]),
  label: z.string().min(1).max(2_000),
});

export const reasoningEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(["SUPPORTED_BY", "OWNED_BY", "DEPENDS_ON", "CONTRADICTS", "SUPERSEDES"]),
});

export const reasoningPathSchema = z.object({
  nodes: z.array(reasoningNodeSchema).max(60),
  edges: z.array(reasoningEdgeSchema).max(100),
});

export const graphToolTraceSchema = z.object({
  name: z.enum(["search_project_knowledge", "trace_dependencies", "find_conflicts", "get_owners_and_deadlines"]),
  durationMs: z.number().int().nonnegative(),
  resultCount: z.number().int().nonnegative(),
});

export const generationTraceSchema = z.object({
  id: idSchema,
  model: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  toolCalls: z.array(graphToolTraceSchema).max(4),
  evidenceIds: z.array(z.string()),
  retrievalMs: z.number().int().nonnegative(),
  generationMs: z.number().int().nonnegative(),
  totalMs: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  cacheHitTokens: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
});

export const suggestionDraftSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  version: z.number().int().positive(),
  mode: z.enum(["answer", "support", "clarify"]),
  trigger: z.enum(["manual", "auto"]).default("manual"),
  whyNow: z.string().max(240).nullable().default(null),
  text: z.string().min(1).max(600),
  evidence: z.array(evidenceSchema),
  responseTargets: z.array(responseTargetSchema).max(10).default([]),
  reasoningPath: reasoningPathSchema.default({ nodes: [], edges: [] }),
  toolCalls: z.array(graphToolTraceSchema).max(4).default([]),
  learnedFromCount: z.number().int().nonnegative().default(0),
  trace: generationTraceSchema.nullable().default(null),
  basis: z.enum(["notes", "meeting", "mixed", "needs_context"]),
  transcriptRevision: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export const autoSuggestionStateSchema = z.object({
  enabled: z.boolean(),
  lastRevision: z.number().int().nonnegative(),
  mutedUntilRevision: z.number().int().nonnegative(),
});

export const autoSuggestionRequestSchema = z.object({
  transcriptRevision: z.number().int().positive(),
}).strict();

export const autoSuggestionSettingSchema = z.object({
  enabled: z.boolean(),
}).strict();

export const speechStateSchema = z.object({
  id: idSchema,
  status: z.enum([
    "queued",
    "claimed",
    "preparing",
    "playing",
    "completed",
    "cancelled",
    "failed",
    "uncertain",
    "expired",
  ]),
  approvedText: z.string().min(1).max(600),
  createdAt: z.string(),
  errorCode: z.string().nullable(),
});

export const assistanceRequestSchema = z.object({
  mode: z.enum(["answer", "support", "clarify"]),
  selectedUtteranceIds: z.array(idSchema).max(10),
  transcriptRevision: z.number().int().nonnegative(),
});

export const approvalRequestSchema = z.object({
  suggestionId: idSchema,
  version: z.number().int().positive(),
  approvedText: z.string().trim().min(1).max(600),
  clientRequestId: idSchema,
  reviewedTranscriptRevision: z.number().int().nonnegative(),
});

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string(),
});

export const sessionStateSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  meetingPlatform: z.enum(["google_meet", "zoom"]),
  status: z.enum(["joining", "waiting", "listening", "ending", "ended", "failed", "uncertain"]),
  transcriptRevision: z.number().int().nonnegative(),
  stopRevision: z.number().int().nonnegative(),
  mediaReady: z.boolean(),
  recentUtterances: z.array(transcriptTurnSchema),
  currentSuggestion: suggestionDraftSchema.nullable(),
  activeSpeech: speechStateSchema.nullable(),
});

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ResponseTarget = z.infer<typeof responseTargetSchema>;
export type ReasoningPath = z.infer<typeof reasoningPathSchema>;
export type GraphToolTrace = z.infer<typeof graphToolTraceSchema>;
export type GenerationTrace = z.infer<typeof generationTraceSchema>;
export type SuggestionDraft = z.infer<typeof suggestionDraftSchema>;
export type AutoSuggestionState = z.infer<typeof autoSuggestionStateSchema>;
export type SpeechState = z.infer<typeof speechStateSchema>;
export type AssistanceRequest = z.infer<typeof assistanceRequestSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;
