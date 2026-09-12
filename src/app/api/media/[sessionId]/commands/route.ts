import { z } from "zod";
import { meetingErrorResponse } from "@/lib/server/meetings";
import { acknowledgeCommand, heartbeatAndClaim, mediaTokenFrom, parseAcknowledgement } from "@/lib/server/speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const sessionId = z.string().uuid().parse((await params).sessionId);
    const result = await heartbeatAndClaim(mediaTokenFrom(request), sessionId);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const sessionId = z.string().uuid().parse((await params).sessionId);
    const input = parseAcknowledgement(await request.json());
    return Response.json(await acknowledgeCommand(mediaTokenFrom(request), sessionId, input), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
