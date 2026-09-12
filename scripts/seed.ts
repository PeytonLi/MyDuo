import { loadEnvFile } from "node:process";

loadEnvFile(".env.local");

const ids = {
  owner: "demo-owner",
  project: "11111111-1111-4111-8111-111111111111",
  source: "22222222-2222-4222-8222-222222222222",
  decision: "33333333-3333-4333-8333-333333333333",
  deadline: "44444444-4444-4444-8444-444444444444",
  person: "55555555-5555-4555-8555-555555555555",
};

const constraints = [
  ["user_id", "User", "id"],
  ["project_id", "Project", "id"],
  ["person_id", "Person", "id"],
  ["source_id", "Source", "id"],
  ["fact_id", "Fact", "id"],
  ["session_id", "Session", "id"],
  ["utterance_id", "Utterance", "id"],
  ["suggestion_id", "Suggestion", "id"],
  ["review_candidate_id", "ReviewCandidate", "id"],
  ["speech_command_id", "SpeechCommand", "id"],
  ["access_session_token", "AccessSession", "tokenHash"],
  ["recall_delivery_id", "RecallDelivery", "id"],
] as const;

async function seed() {
  const { getDriver, writeQuery } = await import("../src/lib/server/db");
  try {
    await writeQuery(async (tx) => {
    for (const [name, label, property] of constraints) {
      // These identifiers are fixed in source; no user-controlled Cypher is accepted.
      await tx.run(`CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (n:${label}) REQUIRE n.${property} IS UNIQUE`);
    }
    await tx.run(
      `CREATE CONSTRAINT utterance_delivery IF NOT EXISTS
       FOR (n:Utterance) REQUIRE (n.sessionId, n.providerEventId) IS UNIQUE`,
    );
    await tx.run(
      `CREATE CONSTRAINT speech_request IF NOT EXISTS
       FOR (n:SpeechCommand) REQUIRE (n.sessionId, n.clientRequestId) IS UNIQUE`,
    );
    });

    const now = new Date().toISOString();
    await writeQuery(async (tx) => {
      await tx.run(
      `MERGE (user:User {id: $ownerId})
       SET user.role = 'Product lead',
           user.priorities = 'Keep the demo focused, trustworthy, and easy to explain.',
           user.tone = 'Warm, concise, confident, and candid about uncertainty.',
           user.responseExamples = 'Lead with the answer, then give one concrete reason.'
       MERGE (project:Project {id: $projectId})
       SET project.ownerId = $ownerId, project.name = 'MyDuo hackathon demo', project.createdAt = $now
       MERGE (user)-[:OWNS]->(project)
       MERGE (source:Source {id: $sourceId})
       SET source.ownerId = $ownerId, source.projectId = $projectId,
           source.title = 'Demo plan',
           source.text = 'The first demo supports Google Meet. MyDuo drafts privately and only speaks after the operator reviews and approves the exact words. The live demo should be ready before Friday at 3 PM Pacific.',
           source.createdAt = $now, source.occurredAt = $now, source.allowMeetingUse = true
       MERGE (project)-[:HAS_SOURCE]->(source)
       MERGE (person:Person {id: $personId})
       SET person.ownerId = $ownerId, person.name = 'Demo owner', person.nameKey = 'demo owner'
       MERGE (decision:Fact {id: $decisionId})
       SET decision.ownerId = $ownerId, decision.projectId = $projectId,
           decision.kind = 'decision', decision.text = 'MyDuo only speaks text the operator explicitly approves.',
           decision.status = 'confirmed', decision.confirmedAt = $now
       MERGE (deadline:Fact {id: $deadlineId})
       SET deadline.ownerId = $ownerId, deadline.projectId = $projectId,
           deadline.kind = 'deadline', deadline.text = 'The live demo should be ready before Friday at 3 PM Pacific.',
           deadline.status = 'confirmed', deadline.confirmedAt = $now
       MERGE (project)-[:HAS_FACT]->(decision)
       MERGE (project)-[:HAS_FACT]->(deadline)
       MERGE (decision)-[:SUPPORTED_BY]->(source)
       MERGE (deadline)-[:SUPPORTED_BY]->(source)
       MERGE (deadline)-[:DEPENDS_ON]->(decision)
       MERGE (deadline)-[:OWNED_BY]->(person)`,
      {
        ownerId: ids.owner,
        projectId: ids.project,
        sourceId: ids.source,
        decisionId: ids.decision,
        deadlineId: ids.deadline,
        personId: ids.person,
        now,
      },
      );
    });
    console.log(`Seeded MyDuo demo project ${ids.project}.`);
  } finally {
    await getDriver().close();
  }
}

seed()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
