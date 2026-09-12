import { recallConfig } from "@/lib/server/env";
import { meetingErrorResponse } from "@/lib/server/meetings";
import { verifyRecallWebhook } from "@/lib/server/recall";
import { ingestTranscript, parseTranscriptEvent } from "@/lib/server/transcripts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (!verifyRecallWebhook(raw, request.headers, recallConfig().verificationSecret)) {
      return Response.json({ ok: false }, { status: 401 });
    }
    const eventId = request.headers.get("webhook-id")!;
    const result = await ingestTranscript(eventId, parseTranscriptEvent(JSON.parse(raw)));
    return Response.json({ ok: result.knownSession, duplicate: result.duplicate }, { status: result.knownSession ? 200 : 404 });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
