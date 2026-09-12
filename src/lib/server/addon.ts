import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { writeQuery } from "./db";
import { MeetingError } from "./meetings";

const pairingSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-F0-9]{10}$/) });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function parsePairingCode(value: unknown) {
  return pairingSchema.parse(value);
}

export async function createAddonPair(ownerId: string, sessionId: string) {
  const code = randomBytes(5).toString("hex").toUpperCase();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  return writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (s:Session {id: $sessionId, ownerId: $ownerId})
       WHERE s.status IN ['joining', 'waiting', 'listening', 'uncertain']
       OPTIONAL MATCH (old:AccessSession {scopedSessionId: $sessionId, kind: 'addon_pair'})
       DETACH DELETE old
       CREATE (:AccessSession {
         tokenHash: $tokenHash, ownerId: $ownerId, scopedSessionId: $sessionId,
         kind: 'addon_pair', expiresAt: datetime($expiresAt), createdAt: $now
       })
       RETURN s.id AS sessionId`,
      { ownerId, sessionId, tokenHash: hash(code), expiresAt, now },
    );
    if (!result.records.length) throw new MeetingError("Active meeting not found", "SESSION_NOT_FOUND", 404);
    return { code, expiresAt };
  });
}

export async function exchangeAddonPair(code: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
  return writeQuery(async (tx) => {
    const result = await tx.run(
      `MATCH (pair:AccessSession {tokenHash: $pairHash, kind: 'addon_pair'}),
             (s:Session {id: pair.scopedSessionId, ownerId: pair.ownerId})
       WHERE pair.expiresAt > datetime() AND pair.usedAt IS NULL
         AND s.status IN ['joining', 'waiting', 'listening', 'uncertain']
       SET pair.usedAt = datetime($now)
       CREATE (:AccessSession {
         tokenHash: $tokenHash, ownerId: pair.ownerId, scopedSessionId: s.id,
         kind: 'addon', expiresAt: datetime($expiresAt), createdAt: $now
       })
       RETURN s.id AS sessionId`,
      { pairHash: hash(code), tokenHash: hash(token), expiresAt, now },
    );
    const sessionId = result.records[0]?.get("sessionId");
    if (!sessionId) throw new MeetingError("Pairing code is invalid or expired", "ADDON_PAIR_INVALID", 401);
    return { token, sessionId: String(sessionId), expiresAt };
  });
}
