import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { idSchema } from "@/lib/contracts";
import { assertMutationOrigin, AuthError, requireOperator } from "@/lib/server/auth";
import { MemoryInputError } from "@/lib/server/memory";
import {
  generateAutoSuggestion,
  getAutoSuggestionState,
  setAutoSuggestionEnabled,
  SuggestionGenerationError,
} from "@/lib/server/suggestions";

export const runtime = "nodejs";

function failure(error: unknown) {
  const status = error instanceof AuthError ? 401
    : error instanceof ZodError || error instanceof SyntaxError || error instanceof MemoryInputError ? 400
      : error instanceof SuggestionGenerationError ? 502 : 500;
  const requestId = randomUUID();
  if (status >= 500) console.error("Automatic suggestion request failed", { requestId, error });
  return Response.json({
    code: status === 401 ? "UNAUTHORIZED" : status === 400 ? "INVALID_INPUT" : status === 502 ? "MODEL_ERROR" : "INTERNAL_ERROR",
    message: status >= 500 ? "MyDuo could not draft a question." : error instanceof Error ? error.message : "Invalid request.",
    retryable: status >= 500,
    requestId,
  }, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ownerId } = await requireOperator(request);
    return Response.json(await getAutoSuggestionState(ownerId, idSchema.parse((await params).id)));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    return Response.json(await setAutoSuggestionEnabled(ownerId, idSchema.parse((await params).id), await request.json()));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    const suggestion = await generateAutoSuggestion(ownerId, idSchema.parse((await params).id), await request.json());
    return Response.json({ suggestion }, { status: suggestion ? 201 : 200 });
  } catch (error) {
    return failure(error);
  }
}
