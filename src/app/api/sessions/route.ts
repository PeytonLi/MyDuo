import { z } from "zod";
import { assertMutationOrigin, requireOperator } from "@/lib/server/auth";
import { createMeeting, meetingErrorResponse } from "@/lib/server/meetings";

export const runtime = "nodejs";

const createSessionSchema = z.object({
  meetingUrl: z.string().max(500),
  consentConfirmed: z.literal(true),
  projectId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    const input = createSessionSchema.parse(await request.json());
    return Response.json(await createMeeting(ownerId, input), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
