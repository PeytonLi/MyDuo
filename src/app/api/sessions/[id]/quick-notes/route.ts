import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { idSchema } from "@/lib/contracts";
import { assertMutationOrigin, AuthError, requireOperator } from "@/lib/server/auth";
import { createQuickNote, ReviewInputError } from "@/lib/server/reviews";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    const candidate = await createQuickNote(ownerId, idSchema.parse((await params).id), await request.json());
    return Response.json(candidate, { status: 201 });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : error instanceof ZodError || error instanceof SyntaxError || error instanceof ReviewInputError ? 400 : 500;
    const requestId = randomUUID();
    if (status >= 500) console.error("Quick note failed", { requestId, error });
    return Response.json({
      code: status === 401 ? "UNAUTHORIZED" : status === 400 ? "INVALID_INPUT" : "INTERNAL_ERROR",
      message: status >= 500 ? "MyDuo could not save that note." : error instanceof Error ? error.message : "Invalid request.",
      retryable: status >= 500,
      requestId,
    }, { status });
  }
}
