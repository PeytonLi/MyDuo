import { z } from "zod";
import { meetingErrorResponse } from "@/lib/server/meetings";
import { assertApprovedAudioActive, failCommand, mediaTokenFrom, prepareApprovedAudio, streamApprovedText } from "@/lib/server/speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string; commandId: string }> };

export async function GET(request: Request, { params }: Context) {
  let sessionId = "";
  let commandId = "";
  let authorized = false;
  try {
    const parsed = await params;
    sessionId = z.string().uuid().parse(parsed.sessionId);
    commandId = z.string().uuid().parse(parsed.commandId);
    const mediaTokenHash = mediaTokenFrom(request);
    const approved = await prepareApprovedAudio(mediaTokenHash, sessionId, commandId);
    authorized = true;
    const audio = await streamApprovedText(approved.text, approved.voiceId, request.signal);
    await assertApprovedAudioActive(mediaTokenHash, sessionId, commandId);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const aborted = request.signal.aborted || (error instanceof Error && error.name === "AbortError");
    if (authorized && !aborted) await failCommand(sessionId, commandId, "TTS_FAILED").catch(() => undefined);
    return meetingErrorResponse(error);
  }
}
