import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { readQuery, writeQuery } from "./db";

const COOKIE_NAME = "myduo_session";
const OWNER_ID = "demo-owner";
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

// ponytail: this process-local limiter is enough for one demo instance; move it to shared storage before horizontal scaling.
const attempts = new Map<string, { count: number; resetAt: number }>();

const digest = (value: string) => createHash("sha256").update(value).digest();
const tokenHash = (value: string) => digest(value).toString("hex");

export class AuthError extends Error {}

export function verifyAccessSecret(candidate: string) {
  const expected = process.env.DEMO_ACCESS_SECRET?.trim();
  if (!expected) throw new Error("Missing required environment variable: DEMO_ACCESS_SECRET");
  return timingSafeEqual(digest(candidate), digest(expected));
}

export function consumeLoginAttempt(key: string, now = Date.now()) {
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1_000 });
    return true;
  }
  if (current.count >= 5) return false;
  current.count += 1;
  return true;
}

export function resetLoginAttempts(key: string) {
  attempts.delete(key);
}

export function assertMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = process.env.APP_BASE_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  if (origin !== expected) throw new AuthError("Invalid request origin");
}

export async function createOperatorSession() {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await writeQuery(async (tx) => {
    await tx.run(
      `MERGE (u:User {id: $ownerId})
       ON CREATE SET u.role = '', u.priorities = [], u.tone = '', u.responseExamples = []
       CREATE (s:AccessSession {tokenHash: $tokenHash, ownerId: $ownerId, kind: 'operator', expiresAt: datetime($expiresAt)})`,
      { ownerId: OWNER_ID, tokenHash: tokenHash(token), expiresAt },
    );
  });
  return { token, expiresAt };
}

export async function requireOperator(request?: Request, scopedSessionId?: string) {
  const authorization = request?.headers.get("authorization");
  const addonToken = scopedSessionId ? authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/)?.[1] : undefined;
  const cookieToken = addonToken ? undefined : (await cookies()).get(COOKIE_NAME)?.value;
  const token = cookieToken || addonToken;
  if (!token) throw new AuthError("Sign in required");
  const ownerId = await readQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:AccessSession {tokenHash: $tokenHash, kind: $kind})
       WHERE s.expiresAt > datetime()
         AND ($scopedSessionId IS NULL OR s.scopedSessionId = $scopedSessionId)
       WITH s LIMIT 1
       RETURN s.ownerId AS ownerId`,
      { tokenHash: tokenHash(token), kind: cookieToken ? "operator" : "addon", scopedSessionId: cookieToken ? null : scopedSessionId },
    );
    return result.records[0]?.get("ownerId") as string | undefined;
  });
  if (!ownerId) throw new AuthError("Session expired");
  return { ownerId };
}

export async function deleteOperatorSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await writeQuery(async (tx) => {
      await tx.run("MATCH (s:AccessSession {tokenHash: $tokenHash}) DETACH DELETE s", { tokenHash: tokenHash(token) });
    });
  }
}

export const operatorCookie = (token: string, expiresAt: string) => ({
  name: COOKIE_NAME,
  value: token,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  expires: new Date(expiresAt),
});

export const expiredOperatorCookie = () => ({
  name: COOKIE_NAME,
  value: "",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  expires: new Date(0),
});
