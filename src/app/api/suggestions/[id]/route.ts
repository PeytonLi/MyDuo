import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { idSchema } from "@/lib/contracts";
import { assertMutationOrigin, AuthError, requireOperator } from "@/lib/server/auth";
import { MemoryInputError } from "@/lib/server/memory";
import { dismissSuggestion, editSuggestion } from "@/lib/server/suggestions";

export const runtime = "nodejs";

const failure = (error: unknown) => {
  const status = error instanceof AuthError ? 401 : error instanceof ZodError || error instanceof SyntaxError || error instanceof MemoryInputError ? 400 : 500;
  return Response.json(
    { code: status === 401 ? "UNAUTHORIZED" : status === 400 ? "INVALID_INPUT" : "INTERNAL_ERROR", message: status === 500 ? "Unable to update the suggestion." : error instanceof Error ? error.message : "Invalid request.", retryable: status === 500, requestId: randomUUID() },
    { status },
  );
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    return Response.json(await editSuggestion(ownerId, idSchema.parse((await params).id), await request.json()));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    return Response.json(await dismissSuggestion(ownerId, idSchema.parse((await params).id)));
  } catch (error) {
    return failure(error);
  }
}
