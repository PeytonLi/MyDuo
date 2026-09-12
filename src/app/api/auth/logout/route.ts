import { NextResponse } from "next/server";
import { assertMutationOrigin, deleteOperatorSession, expiredOperatorCookie } from "@/lib/server/auth";

export async function POST(request: Request) {
  assertMutationOrigin(request);
  await deleteOperatorSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(expiredOperatorCookie());
  return response;
}
