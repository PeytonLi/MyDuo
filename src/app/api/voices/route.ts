import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { assertMutationOrigin, AuthError, requireOperator } from "@/lib/server/auth";
import { allowedVoice, elevenLabsVoices } from "@/lib/server/env";
import { consumeVoicePreview, synthesizeApprovedText, VOICE_PREVIEW_TEXT } from "@/lib/server/speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewSchema = z.object({ voiceId: z.string().max(64).refine((id) => Boolean(allowedVoice(id)), "Choose an available voice") });

const failure = (error: unknown) => {
  const status = error instanceof AuthError ? 401 : error instanceof ZodError || error instanceof SyntaxError ? 400 : 502;
  return Response.json(
    { code: status === 401 ? "UNAUTHORIZED" : status === 400 ? "INVALID_INPUT" : "TTS_FAILED", message: status === 502 ? "Voice preview is unavailable." : error instanceof Error ? error.message : "Invalid request.", retryable: status === 502, requestId: randomUUID() },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
};

export async function GET(request: Request) {
  try {
    await requireOperator(request);
    return Response.json(elevenLabsVoices(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    const { voiceId } = previewSchema.parse(await request.json());
    if (!consumeVoicePreview(ownerId)) {
      return Response.json(
        { code: "PREVIEW_RATE_LIMITED", message: "Please wait a moment before previewing another voice.", retryable: true, requestId: randomUUID() },
        { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
      );
    }
    const audio = await synthesizeApprovedText(VOICE_PREVIEW_TEXT, voiceId);
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "Content-Length": String(audio.byteLength) } });
  } catch (error) {
    return failure(error);
  }
}
