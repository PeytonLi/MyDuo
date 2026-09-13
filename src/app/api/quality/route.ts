import { randomUUID } from "node:crypto";
import { AuthError, requireOperator } from "@/lib/server/auth";
import { getQualityDashboard } from "@/lib/server/quality";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { ownerId } = await requireOperator(request);
    return Response.json(await getQualityDashboard(ownerId));
  } catch (error) {
    const requestId = randomUUID();
    if (!(error instanceof AuthError)) console.error("Quality dashboard request failed", { requestId, error });
    return Response.json({
      code: error instanceof AuthError ? "UNAUTHORIZED" : "INTERNAL_ERROR",
      message: error instanceof AuthError ? error.message : "Quality measurements are unavailable.",
      retryable: !(error instanceof AuthError),
      requestId,
    }, { status: error instanceof AuthError ? 401 : 500 });
  }
}
