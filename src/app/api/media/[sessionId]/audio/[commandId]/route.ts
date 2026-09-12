import { z } from "zod";
import { meetingErrorResponse } from "@/lib/server/meetings";
import { failCommand, mediaTokenFrom, prepareApprovedAudio, synthesizeApprovedText } from "@/lib/server/speech";

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
    const approvedText = await prepareApprovedAudio(mediaTokenFrom(request), sessionId, commandId);
    authorized = true;
    const audio = await synthesizeApprovedText(approvedText);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
        "Content-Length": String(audio.byteLength),
      },
    });
  } catch (error) {
    if (authorized) await failCommand(sessionId, commandId, "TTS_FAILED").catch(() => undefined);
    return meetingErrorResponse(error);
  }
}
