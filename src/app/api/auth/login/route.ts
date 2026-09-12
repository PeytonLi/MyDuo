import { z } from "zod";
import { NextResponse } from "next/server";
import {
  assertMutationOrigin,
  consumeLoginAttempt,
  createOperatorSession,
  operatorCookie,
  resetLoginAttempts,
  verifyAccessSecret,
} from "@/lib/server/auth";

const bodySchema = z.object({ secret: z.string().min(1).max(500) });

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertMutationOrigin(request);
    const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!consumeLoginAttempt(key)) {
      return NextResponse.json({ code: "RATE_LIMITED", message: "Try again in a few minutes.", retryable: true, requestId }, { status: 429 });
    }
    const { secret } = bodySchema.parse(await request.json());
    if (!verifyAccessSecret(secret)) {
      return NextResponse.json({ code: "INVALID_LOGIN", message: "That access key is not valid.", retryable: false, requestId }, { status: 401 });
    }
    resetLoginAttempts(key);
    const session = await createOperatorSession();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(operatorCookie(session.token, session.expiresAt));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign in";
    return NextResponse.json({ code: "LOGIN_FAILED", message, retryable: false, requestId }, { status: 400 });
  }
}
