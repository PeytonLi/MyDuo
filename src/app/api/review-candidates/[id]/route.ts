import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { idSchema } from "@/lib/contracts";
import { assertMutationOrigin, AuthError, requireOperator } from "@/lib/server/auth";
import { ReviewConflictError, ReviewInputError, updateReviewCandidate } from "@/lib/server/reviews";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    return Response.json(await updateReviewCandidate(ownerId, idSchema.parse((await params).id), await request.json()));
  } catch (error) {
    const status = error instanceof AuthError ? 401 : error instanceof ReviewConflictError ? 409 : error instanceof ZodError || error instanceof SyntaxError || error instanceof ReviewInputError ? 400 : 500;
    return Response.json({
      code: status === 401 ? "UNAUTHORIZED" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_INPUT" : "INTERNAL_ERROR",
      message: status === 500 ? "Unable to update meeting memory." : error instanceof Error ? error.message : "Invalid request.",
      retryable: status === 500,
      requestId: randomUUID(),
    }, { status });
  }
}
