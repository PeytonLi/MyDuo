import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { idSchema } from "@/lib/contracts";
import { assertMutationOrigin, AuthError, requireOperator } from "@/lib/server/auth";
import { extractMeetingReview, ReviewConflictError, ReviewGenerationError, ReviewInputError } from "@/lib/server/reviews";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    return Response.json({ candidates: await extractMeetingReview(ownerId, idSchema.parse((await params).id)) });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : error instanceof ReviewConflictError ? 409 : error instanceof ZodError || error instanceof ReviewInputError ? 400 : error instanceof ReviewGenerationError ? 502 : 500;
    const requestId = randomUUID();
    if (status >= 500) console.error("Meeting review failed", { requestId, error });
    return Response.json({
      code: status === 401 ? "UNAUTHORIZED" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_INPUT" : status === 502 ? "MODEL_ERROR" : "INTERNAL_ERROR",
      message: status >= 500 ? "MyDuo could not prepare the meeting review." : error instanceof Error ? error.message : "Invalid request.",
      retryable: status >= 500 || status === 409,
      requestId,
    }, { status });
  }
}
