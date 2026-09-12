import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getDriver, readQuery, writeQuery } from "../src/lib/server/db";
import { getSuggestionContext } from "../src/lib/server/memory";
import { boundReviewTranscript, createQuickNote, extractMeetingReview, formatAcceptedSourceText, parseReviewOutput, updateReviewCandidate } from "../src/lib/server/reviews";

const id = () => randomUUID();

test("review parsing bounds transcript and allowlists evidence", () => {
  const a = id();
  const b = id();
  const lines = [
    { id: a, speakerName: "A", text: "1234", startMs: 0 },
    { id: b, speakerName: "B", text: "5678", startMs: 1 },
  ];
  assert.deepEqual(boundReviewTranscript(lines, 6).map((line) => line.text), ["34", "5678"]);
  assert.equal(formatAcceptedSourceText("Ship Friday.", lines), "Ship Friday.\n\nSupporting transcript:\nA: 1234\nB: 5678");
  assert.equal(parseReviewOutput(JSON.stringify({ candidates: [{ factKind: "deadline", text: "Ship Friday.", ownerName: null, evidenceIds: [a] }] }), new Set([a]))[0].text, "Ship Friday.");
  assert.throws(() => parseReviewOutput(JSON.stringify({ candidates: [{ factKind: "decision", text: "Secret", ownerName: null, evidenceIds: [b] }] }), new Set([a])));
});

test("accepted review memory is scoped, exact, and idempotent", { timeout: 30_000 }, async () => {
  const ownerId = `qa-review-${id()}`;
  const otherOwnerId = `qa-review-other-${id()}`;
  const projectId = id();
  const sessionId = id();
  const candidateId = id();
  const utteranceId = id();
  const sourceId = id();
  const factId = id();
  const rejectedCandidateId = id();
  const rejectedSourceId = id();
  const rejectedFactId = id();
  try {
    await writeQuery(async (tx) => tx.run(
      `CREATE (project:Project {id: $projectId, ownerId: $ownerId, name: 'Review QA'})
       CREATE (session:Session {id: $sessionId, ownerId: $ownerId, projectId: $projectId, status: 'ended', updatedAt: $now})
       CREATE (utterance:Utterance {id: $utteranceId, sessionId: $sessionId, speakerName: 'Alex', text: 'Morgan owns the Friday launch.', startMs: 0, revision: 1, isBot: false})
       CREATE (candidate:ReviewCandidate {id: $candidateId, ownerId: $ownerId, sessionId: $sessionId, projectId: $projectId,
         factKind: 'responsibility', text: 'Draft text', ownerName: 'Morgan', evidenceIds: [$utteranceId],
         status: 'pending', position: 0, sourceId: $sourceId, factId: $factId})
       CREATE (rejected:ReviewCandidate {id: $rejectedCandidateId, ownerId: $ownerId, sessionId: $sessionId, projectId: $projectId,
         factKind: 'decision', text: 'Do not save', evidenceIds: [$utteranceId], status: 'pending',
         position: 1, sourceId: $rejectedSourceId, factId: $rejectedFactId})
       SET session.reviewExtractionStatus = 'ready'
       CREATE (project)-[:HAS_SESSION]->(session)
       CREATE (session)-[:HAS_REVIEW_CANDIDATE]->(candidate)
       CREATE (session)-[:HAS_REVIEW_CANDIDATE]->(rejected)`,
      { ownerId, projectId, sessionId, candidateId, rejectedCandidateId, utteranceId, sourceId, factId, rejectedSourceId, rejectedFactId, now: new Date().toISOString() },
    ));

    assert.equal((await extractMeetingReview(ownerId, sessionId))[0].id, candidateId, "repeated extraction must reuse stored candidates");
    const before = await readQuery(async (tx) => tx.run(
      "MATCH (n) WHERE n.id IN [$sourceId, $factId] RETURN count(n) AS count",
      { sourceId, factId },
    ));
    assert.equal(before.records[0].get("count").toNumber(), 0, "pending candidates must not create memory");
    await assert.rejects(() => updateReviewCandidate(otherOwnerId, candidateId, { action: "accept" }));
    const edited = await updateReviewCandidate(ownerId, candidateId, {
      action: "edit", factKind: "deadline", text: "Launch Friday.", ownerName: "Morgan",
    });
    assert.equal(edited.text, "Launch Friday.");
    const accepted = await updateReviewCandidate(ownerId, candidateId, { action: "accept" });
    assert.equal(accepted.status, "accepted");
    assert.equal((await updateReviewCandidate(ownerId, candidateId, { action: "accept" })).factId, factId);
    const saved = await readQuery(async (tx) => tx.run(
      `MATCH (fact:Fact {id: $factId, ownerId: $ownerId})-[:SUPPORTED_BY]->(source:Source {id: $sourceId})
       RETURN fact.text AS text, fact.kind AS kind, fact.status AS status,
              source.allowMeetingUse AS allowed, source.evidenceIds AS evidenceIds,
              count(fact) AS count`,
      { ownerId, factId, sourceId },
    ));
    assert.equal(saved.records[0].get("text"), "Launch Friday.");
    assert.equal(saved.records[0].get("kind"), "deadline");
    assert.equal(saved.records[0].get("status"), "confirmed");
    assert.equal(saved.records[0].get("allowed"), true);
    assert.deepEqual(saved.records[0].get("evidenceIds"), [utteranceId]);
    assert.equal(saved.records[0].get("count").toNumber(), 1);
    assert.equal((await updateReviewCandidate(ownerId, rejectedCandidateId, { action: "reject" })).status, "rejected");
    await assert.rejects(() => updateReviewCandidate(ownerId, rejectedCandidateId, { action: "accept" }));
    const rejectedMemory = await readQuery(async (tx) => tx.run(
      "MATCH (n) WHERE n.id IN [$sourceId, $factId] RETURN count(n) AS count",
      { sourceId: rejectedSourceId, factId: rejectedFactId },
    ));
    assert.equal(rejectedMemory.records[0].get("count").toNumber(), 0, "rejected candidates must not create memory");
  } finally {
    await writeQuery(async (tx) => { await tx.run("MATCH (n) WHERE n.ownerId IN [$ownerId, $otherOwnerId] DETACH DELETE n", { ownerId, otherOwnerId }); });
  }
});

test("quick notes capture during a live meeting and surface in review", { timeout: 30_000 }, async () => {
  const ownerId = `qa-quick-${id()}`;
  const otherOwnerId = `qa-quick-other-${id()}`;
  const projectId = id();
  const sessionId = id();
  const utteranceId = id();
  try {
    await writeQuery(async (tx) => tx.run(
      `CREATE (project:Project {id: $projectId, ownerId: $ownerId, name: 'Quick QA'})
       CREATE (session:Session {id: $sessionId, ownerId: $ownerId, projectId: $projectId,
         status: 'listening', transcriptRevision: 1, updatedAt: $now})
       CREATE (utterance:Utterance {id: $utteranceId, sessionId: $sessionId, speakerName: 'Alex',
         text: 'The audit blocks the launch.', startMs: 0, revision: 1, isBot: false})
       CREATE (project)-[:HAS_SESSION]->(session)
       CREATE (session)-[:HAS_UTTERANCE]->(utterance)`,
      { ownerId, projectId, sessionId, utteranceId, now: new Date().toISOString() },
    ));

    await assert.rejects(() => createQuickNote(otherOwnerId, sessionId, { text: "Someone else's note." }));
    await assert.rejects(() => createQuickNote(ownerId, sessionId, { text: "Stolen evidence.", selectedUtteranceIds: [id()] }),
      /Selected transcript lines do not belong to this meeting/);

    const note = await createQuickNote(ownerId, sessionId, { text: "Launch waits on the audit.", selectedUtteranceIds: [utteranceId] });
    assert.equal(note.status, "pending");
    assert.deepEqual(note.evidenceIds, [utteranceId]);

    await writeQuery(async (tx) => tx.run(
      "MATCH (session:Session {id: $sessionId, ownerId: $ownerId}) SET session.status = 'ended', session.reviewExtractionStatus = ''",
      { ownerId, sessionId },
    ));

    const candidates = await extractMeetingReview(ownerId, sessionId);
    const reviewNote = candidates.find((candidate) => candidate.id === note.id);
    assert.ok(reviewNote, "quick note must survive into the meeting review");
    assert.equal(reviewNote?.text, "Launch waits on the audit.");
    assert.equal(reviewNote?.factKind, "decision");
    const accepted = await updateReviewCandidate(ownerId, note.id, {
      action: "accept", factKind: "dependency", text: "Launch waits on the audit.", ownerName: null,
    });
    assert.equal(accepted.status, "accepted");
  } finally {
    await writeQuery(async (tx) => { await tx.run("MATCH (n) WHERE n.ownerId IN [$ownerId, $otherOwnerId] DETACH DELETE n", { ownerId, otherOwnerId }); });
  }
});

test("accepted meeting memory grounds a later meeting in the same project", { timeout: 30_000 }, async () => {
  const ownerId = `qa-ground-${id()}`;
  const projectId = id();
  const sessionAId = id();
  const sessionBId = id();
  const candidateId = id();
  const utteranceAId = id();
  const utteranceBId = id();
  const sourceId = id();
  const factId = id();
  try {
    await writeQuery(async (tx) => tx.run(
      `CREATE (project:Project {id: $projectId, ownerId: $ownerId, name: 'Grounding QA'})
       CREATE (sessionA:Session {id: $sessionAId, ownerId: $ownerId, projectId: $projectId,
         status: 'ended', reviewExtractionStatus: 'ready', updatedAt: $now})
       CREATE (sessionB:Session {id: $sessionBId, ownerId: $ownerId, projectId: $projectId,
         status: 'listening', transcriptRevision: 1, stopRevision: 0, updatedAt: $now})
       CREATE (utteranceA:Utterance {id: $utteranceAId, sessionId: $sessionAId, speakerName: 'Alex',
         text: 'We ship the integration after the audit.', startMs: 0, revision: 1, isBot: false})
       CREATE (utteranceB:Utterance {id: $utteranceBId, sessionId: $sessionBId, speakerName: 'Riley',
         text: 'When can the integration ship?', startMs: 0, revision: 1, isBot: false})
       CREATE (candidate:ReviewCandidate {id: $candidateId, ownerId: $ownerId, sessionId: $sessionAId,
         projectId: $projectId, factKind: 'dependency', text: 'The integration ships after the audit.',
         ownerName: null, evidenceIds: [$utteranceAId], status: 'pending', position: 0,
         sourceId: $sourceId, factId: $factId})
       CREATE (project)-[:HAS_SESSION]->(sessionA)
       CREATE (project)-[:HAS_SESSION]->(sessionB)
       CREATE (sessionA)-[:HAS_UTTERANCE]->(utteranceA)
       CREATE (sessionB)-[:HAS_UTTERANCE]->(utteranceB)
       CREATE (sessionA)-[:HAS_REVIEW_CANDIDATE]->(candidate)`,
      { ownerId, projectId, sessionAId, sessionBId, candidateId, utteranceAId, utteranceBId, sourceId, factId, now: new Date().toISOString() },
    ));

    await updateReviewCandidate(ownerId, candidateId, { action: "accept" });

    const context = await getSuggestionContext(ownerId, sessionBId, {
      mode: "answer",
      selectedUtteranceIds: [],
      transcriptRevision: 1,
    });
    const grounded = context.evidence.find((item) => item.id === sourceId);
    assert.ok(grounded, "accepted meeting memory must be retrievable in a later meeting");
    assert.equal(grounded?.kind, "source");
    assert.ok(grounded?.factIds.includes(factId), "the confirmed fact must support the grounded source");
  } finally {
    await writeQuery(async (tx) => { await tx.run("MATCH (n) WHERE n.ownerId = $ownerId DETACH DELETE n", { ownerId }); });
  }
});

test.after(async () => { await getDriver().close(); });
