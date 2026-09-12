import { loadEnvFile } from "node:process";

loadEnvFile(".env.local");

const ids = {
  owner: "demo-owner",
  project: "11111111-1111-4111-8111-111111111111",
  source: "22222222-2222-4222-8222-222222222222",
  decision: "33333333-3333-4333-8333-333333333333",
  deadline: "44444444-4444-4444-8444-444444444444",
  person: "55555555-5555-4555-8555-555555555555",
  northstarProject: "66666666-6666-4666-8666-666666666666",
  northstarBrief: "77777777-7777-4777-8777-777777777777",
  northstarCheckpoint: "88888888-8888-4888-8888-888888888888",
  northstarDeadline: "99999999-9999-4999-8999-999999999999",
  northstarLegal: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  northstarVideo: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  northstarFallback: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  maya: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  elena: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  mayaResponsibility: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  elenaResponsibility: "12121212-1212-4121-8121-121212121212",
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
    await writeQuery(async (tx) => {
      await tx.run(
        `MATCH (user:User {id: $ownerId})
         MERGE (project:Project {id: $projectId})
         SET project.ownerId = $ownerId, project.name = 'Northstar Summit keynote video', project.createdAt = $now
         MERGE (user)-[:OWNS]->(project)

         MERGE (brief:Source {id: $briefId})
         SET brief.ownerId = $ownerId, brief.projectId = $projectId,
             brief.title = 'Northstar creative brief',
             brief.text = 'The Northstar Summit opens October 15, 2026. The keynote deliverable is a 90-second customer-story video featuring Orion Health. Success means a clean handoff to the events team by October 8 at 2:00 PM Pacific.',
             brief.createdAt = $now, brief.occurredAt = $now, brief.allowMeetingUse = true
         MERGE (checkpoint:Source {id: $checkpointId})
         SET checkpoint.ownerId = $ownerId, checkpoint.projectId = $projectId,
             checkpoint.title = 'Video production checkpoint',
             checkpoint.text = 'Maya Chen owns the final video edit. Elena Ruiz owns legal approval for the Orion Health quote, due October 6 at noon Pacific. If legal approval misses that cutoff, Maya will deliver the approved backup cut without the quote. The final cut cannot lock until the quote decision is made.',
             checkpoint.createdAt = $now, checkpoint.occurredAt = $now, checkpoint.allowMeetingUse = true
         MERGE (project)-[:HAS_SOURCE]->(brief)
         MERGE (project)-[:HAS_SOURCE]->(checkpoint)

         MERGE (maya:Person {id: $mayaId})
         SET maya.ownerId = $ownerId, maya.name = 'Maya Chen', maya.nameKey = 'maya chen'
         MERGE (elena:Person {id: $elenaId})
         SET elena.ownerId = $ownerId, elena.name = 'Elena Ruiz', elena.nameKey = 'elena ruiz'

         MERGE (video:Fact {id: $videoId})
         SET video.ownerId = $ownerId, video.projectId = $projectId, video.kind = 'decision',
             video.text = 'The keynote video will run 90 seconds and center on the Orion Health customer story.',
             video.status = 'confirmed', video.confirmedAt = $now
         MERGE (deadline:Fact {id: $deadlineId})
         SET deadline.ownerId = $ownerId, deadline.projectId = $projectId, deadline.kind = 'deadline',
             deadline.text = 'The final video is due October 8, 2026 at 2:00 PM Pacific.',
             deadline.status = 'confirmed', deadline.confirmedAt = $now
         MERGE (legal:Fact {id: $legalId})
         SET legal.ownerId = $ownerId, legal.projectId = $projectId, legal.kind = 'dependency',
             legal.text = 'Legal approval for the Orion Health quote is due October 6, 2026 at noon Pacific.',
             legal.status = 'confirmed', legal.confirmedAt = $now
         MERGE (fallback:Fact {id: $fallbackId})
         SET fallback.ownerId = $ownerId, fallback.projectId = $projectId, fallback.kind = 'decision',
             fallback.text = 'Use the backup cut without the customer quote if legal approval misses the cutoff.',
             fallback.status = 'confirmed', fallback.confirmedAt = $now
         MERGE (mayaWork:Fact {id: $mayaResponsibilityId})
         SET mayaWork.ownerId = $ownerId, mayaWork.projectId = $projectId, mayaWork.kind = 'responsibility',
             mayaWork.text = 'Maya Chen owns the final video edit and backup cut.',
             mayaWork.status = 'confirmed', mayaWork.confirmedAt = $now
         MERGE (elenaWork:Fact {id: $elenaResponsibilityId})
         SET elenaWork.ownerId = $ownerId, elenaWork.projectId = $projectId, elenaWork.kind = 'responsibility',
             elenaWork.text = 'Elena Ruiz owns legal approval for the customer quote.',
             elenaWork.status = 'confirmed', elenaWork.confirmedAt = $now

         FOREACH (fact IN [video, deadline, legal, fallback, mayaWork, elenaWork] | MERGE (project)-[:HAS_FACT]->(fact))
         MERGE (video)-[:SUPPORTED_BY]->(brief)
         MERGE (deadline)-[:SUPPORTED_BY]->(brief)
         MERGE (deadline)-[:SUPPORTED_BY]->(checkpoint)
         MERGE (legal)-[:SUPPORTED_BY]->(checkpoint)
         MERGE (fallback)-[:SUPPORTED_BY]->(checkpoint)
         MERGE (mayaWork)-[:SUPPORTED_BY]->(checkpoint)
         MERGE (elenaWork)-[:SUPPORTED_BY]->(checkpoint)
         MERGE (deadline)-[:DEPENDS_ON]->(legal)
         MERGE (fallback)-[:DEPENDS_ON]->(legal)
         MERGE (deadline)-[:OWNED_BY]->(maya)
         MERGE (mayaWork)-[:OWNED_BY]->(maya)
         MERGE (legal)-[:OWNED_BY]->(elena)
         MERGE (elenaWork)-[:OWNED_BY]->(elena)`,
        {
          ownerId: ids.owner,
          projectId: ids.northstarProject,
          briefId: ids.northstarBrief,
          checkpointId: ids.northstarCheckpoint,
          videoId: ids.northstarVideo,
          deadlineId: ids.northstarDeadline,
          legalId: ids.northstarLegal,
          fallbackId: ids.northstarFallback,
          mayaId: ids.maya,
          elenaId: ids.elena,
          mayaResponsibilityId: ids.mayaResponsibility,
          elenaResponsibilityId: ids.elenaResponsibility,
          now,
        },
      );
    });
    console.log("Seeded MyDuo demo projects, including Northstar Summit keynote video.");
  } finally {
    await getDriver().close();
  }
}

seed()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
