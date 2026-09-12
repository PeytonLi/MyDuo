import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { idSchema } from "@/lib/contracts";
import { assertMutationOrigin, AuthError, requireOperator } from "@/lib/server/auth";
import { MemoryInputError } from "@/lib/server/memory";
import { generateSuggestion, SuggestionGenerationError } from "@/lib/server/suggestions";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const sessionId = idSchema.parse((await params).id);
    const { ownerId } = await requireOperator(request, sessionId);
    return Response.json(await generateSuggestion(ownerId, sessionId, await request.json()), { status: 201 });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : error instanceof ZodError || error instanceof SyntaxError || error instanceof MemoryInputError ? 400 : error instanceof SuggestionGenerationError ? 502 : 500;
    const requestId = randomUUID();
    if (status >= 500) console.error("Suggestion request failed", { requestId, error });
    return Response.json(
      { code: status === 401 ? "UNAUTHORIZED" : status === 400 ? "INVALID_INPUT" : status === 502 ? "MODEL_ERROR" : "INTERNAL_ERROR", message: status >= 500 ? "MyDuo could not draft a suggestion." : error instanceof Error ? error.message : "Invalid request.", retryable: status >= 500, requestId },
      { status },
    );
  }
}
