import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { assertMutationOrigin, AuthError, requireOperator } from "@/lib/server/auth";
import { getProfile, profileInputSchema, updateProfile } from "@/lib/server/memory";

export const runtime = "nodejs";

const failure = (error: unknown) => {
  const status = error instanceof AuthError ? 401 : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
  return Response.json(
    { code: status === 401 ? "UNAUTHORIZED" : status === 400 ? "INVALID_INPUT" : "INTERNAL_ERROR", message: status === 500 ? "Unable to load the profile." : error instanceof Error ? error.message : "Invalid request.", retryable: status === 500, requestId: randomUUID() },
    { status },
  );
};

export async function GET(request: Request) {
  try {
    const { ownerId } = await requireOperator(request);
    return Response.json(await getProfile(ownerId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertMutationOrigin(request);
    const { ownerId } = await requireOperator(request);
    return Response.json(await updateProfile(ownerId, profileInputSchema.parse(await request.json())));
  } catch (error) {
    return failure(error);
  }
}
