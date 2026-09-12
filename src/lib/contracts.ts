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

export const suggestionDraftSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  version: z.number().int().positive(),
  mode: z.enum(["answer", "support", "clarify"]),
  text: z.string().min(1).max(600),
  evidence: z.array(evidenceSchema),
  basis: z.enum(["notes", "meeting", "mixed", "needs_context"]),
  transcriptRevision: z.number().int().nonnegative(),
  createdAt: z.string(),
});

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
  operatorQuestion: z.string().trim().max(500).optional(),
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
export type SuggestionDraft = z.infer<typeof suggestionDraftSchema>;
export type SpeechState = z.infer<typeof speechStateSchema>;
export type AssistanceRequest = z.infer<typeof assistanceRequestSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;
