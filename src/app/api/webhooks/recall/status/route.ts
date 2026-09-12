import { recallConfig } from "@/lib/server/env";
import { applyRecallStatus, meetingErrorResponse, parseStatusEvent } from "@/lib/server/meetings";
import { verifyRecallWebhook } from "@/lib/server/recall";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (!verifyRecallWebhook(raw, request.headers, recallConfig().statusSecret)) {
      return Response.json({ ok: false }, { status: 401 });
    }
    const result = await applyRecallStatus(request.headers.get("webhook-id")!, parseStatusEvent(JSON.parse(raw)));
    return Response.json({ ok: result.knownSession || result.ignored, ...result }, { status: result.knownSession || result.ignored ? 200 : 404 });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
