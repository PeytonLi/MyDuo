import { z } from "zod";
import { assertMutationOrigin, requireOperator } from "@/lib/server/auth";
import { meetingErrorResponse } from "@/lib/server/meetings";
import { parseApproval, queueSpeech, stopSpeech } from "@/lib/server/speech";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertMutationOrigin(request);
    const id = z.string().uuid().parse((await params).id);
    const { ownerId } = await requireOperator(request, id);
    const input = parseApproval(await request.json());
    return Response.json(await queueSpeech(ownerId, id, input), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertMutationOrigin(request);
    const id = z.string().uuid().parse((await params).id);
    const { ownerId } = await requireOperator(request, id);
    return Response.json(await stopSpeech(ownerId, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
