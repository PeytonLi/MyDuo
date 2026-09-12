import assert from "node:assert/strict";
import { assistanceRequestSchema, approvalRequestSchema } from "../src/lib/contracts";
import { consumeLoginAttempt } from "../src/lib/server/auth";

const id = "123e4567-e89b-42d3-a456-426614174000";
assert.equal(
  assistanceRequestSchema.parse({ mode: "clarify", selectedUtteranceIds: [], transcriptRevision: 0 }).mode,
  "clarify",
);
assert.throws(() =>
  approvalRequestSchema.parse({ suggestionId: id, version: 1, approvedText: "x".repeat(601), clientRequestId: id, reviewedTranscriptRevision: 0 }),
);
for (let index = 0; index < 5; index += 1) assert.equal(consumeLoginAttempt("check", 1_000), true);
assert.equal(consumeLoginAttempt("check", 1_000), false);
console.log("Core contract checks passed.");
