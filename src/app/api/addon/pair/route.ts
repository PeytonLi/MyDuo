import { z } from "zod";
import { createAddonPair } from "@/lib/server/addon";
import { assertMutationOrigin, requireOperator } from "@/lib/server/auth";
import { meetingErrorResponse } from "@/lib/server/meetings";

const inputSchema = z.object({ sessionId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    const { sessionId } = inputSchema.parse(await request.json());
    return Response.json(await createAddonPair(ownerId, sessionId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
