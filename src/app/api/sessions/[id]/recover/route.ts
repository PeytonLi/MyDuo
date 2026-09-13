import { z } from "zod";
import { assertMutationOrigin, requireOperator } from "@/lib/server/auth";
import { meetingErrorResponse, recoverMeeting } from "@/lib/server/meetings";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const id = z.string().uuid().parse((await params).id);
    const { ownerId } = await requireOperator(request, id);
    return Response.json(await recoverMeeting(ownerId, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
