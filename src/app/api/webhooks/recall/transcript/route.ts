import { recallConfig } from "@/lib/server/env";
import { meetingErrorResponse } from "@/lib/server/meetings";
import { verifyRecallWebhook } from "@/lib/server/recall";
import {
  ingestParticipantSpeech,
  ingestTranscript,
  parseParticipantSpeechEvent,
  parseTranscriptEvent,
} from "@/lib/server/transcripts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (!verifyRecallWebhook(raw, request.headers, recallConfig().verificationSecret)) {
      return Response.json({ ok: false }, { status: 401 });
    }
    const eventId = request.headers.get("webhook-id")!;
    const payload: unknown = JSON.parse(raw);
    const event = payload && typeof payload === "object" && "event" in payload ? payload.event : null;
    const result = event === "participant_events.speech_on" || event === "participant_events.speech_off"
      ? await ingestParticipantSpeech(eventId, parseParticipantSpeechEvent(payload))
      : await ingestTranscript(eventId, parseTranscriptEvent(payload));
    return Response.json({ ok: result.knownSession, duplicate: result.duplicate }, { status: result.knownSession ? 200 : 404 });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
