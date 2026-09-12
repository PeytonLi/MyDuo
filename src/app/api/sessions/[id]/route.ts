import { z } from "zod";
import { assertMutationOrigin, requireOperator } from "@/lib/server/auth";
import { endMeeting, getSessionState, meetingErrorResponse } from "@/lib/server/meetings";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { ownerId } = await requireOperator(request);
    const id = z.string().uuid().parse((await params).id);
    return Response.json(await getSessionState(ownerId, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    const id = z.string().uuid().parse((await params).id);
    return Response.json(await endMeeting(ownerId, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
