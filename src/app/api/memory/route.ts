import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { assertMutationOrigin, AuthError, requireOperator } from "@/lib/server/auth";
import {
  createMemory,
  createMemoryInputSchema,
  deleteMemory,
  deleteMemoryInputSchema,
  listMemory,
  MemoryInputError,
  updateMemory,
  updateMemoryInputSchema,
} from "@/lib/server/memory";

export const runtime = "nodejs";

const failure = (error: unknown) => {
  const status = error instanceof AuthError ? 401 : error instanceof ZodError || error instanceof SyntaxError || error instanceof MemoryInputError ? 400 : 500;
  return Response.json(
    { code: status === 401 ? "UNAUTHORIZED" : status === 400 ? "INVALID_INPUT" : "INTERNAL_ERROR", message: status === 500 ? "Unable to update memory." : error instanceof Error ? error.message : "Invalid request.", retryable: status === 500, requestId: randomUUID() },
    { status },
  );
};

export async function GET(request: Request) {
  try {
    const { ownerId } = await requireOperator(request);
    const value = new URL(request.url).searchParams.get("projectId");
    const projectId = value ? z.string().uuid().parse(value) : undefined;
    return Response.json(await listMemory(ownerId, projectId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    return Response.json(await createMemory(ownerId, createMemoryInputSchema.parse(await request.json())), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    return Response.json(await updateMemory(ownerId, updateMemoryInputSchema.parse(await request.json())));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    return Response.json(await deleteMemory(ownerId, deleteMemoryInputSchema.parse(await request.json())));
  } catch (error) {
    return failure(error);
  }
}
