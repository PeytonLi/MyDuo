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
  northstarReviewPlan: "13131313-1313-4131-8131-131313131313",
  northstarVendorPlan: "14141414-1414-4141-8141-141414141414",
  northstarDeliveryPlan: "15151515-1515-4151-8151-151515151515",
  northstarRiskLog: "16161616-1616-4161-8161-161616161616",
  priya: "17171717-1717-4171-8171-171717171717",
  simone: "18181818-1818-4181-8181-181818181818",
  lucas: "19191919-1919-4191-8191-191919191919",
  theo: "20202020-2020-4020-8020-202020202020",
  executiveReview: "21212121-2121-4121-8121-212121212121",
  feedbackRound: "23232323-2323-4232-8232-232323232323",
  pictureLock: "24242424-2424-4242-8242-242424242424",
  soundMix: "25252525-2525-4252-8252-252525252525",
  purchaseOrder: "26262626-2626-4262-8262-262626262626",
  simoneResponsibility: "27272727-2727-4272-8272-272727272727",
  deliveryPackage: "28282828-2828-4282-8282-282828282828",
  accessibilityQc: "29292929-2929-4292-8292-292929292929",
  lucasResponsibility: "30303030-3030-4030-8030-303030303030",
  venuePlayback: "31313131-3131-4131-8131-313131313131",
  theoResponsibility: "32323232-3232-4232-8232-323232323232",
  musicLicense: "34343434-3434-4343-8343-343434343434",
  productCapture: "35353535-3535-4353-8353-353535353535",
  priyaResponsibility: "36363636-3636-4363-8363-363636363636",
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
    await writeQuery(async (tx) => {
      await tx.run(
        `MATCH (project:Project {id: $projectId, ownerId: $ownerId})
         UNWIND $sources AS item
         MERGE (source:Source {id: item.id})
         SET source.ownerId = $ownerId, source.projectId = $projectId,
             source.title = item.title, source.text = item.text,
             source.createdAt = $now, source.occurredAt = $now, source.allowMeetingUse = true
         MERGE (project)-[:HAS_SOURCE]->(source)
         WITH DISTINCT project
         UNWIND $people AS item
         MERGE (person:Person {id: item.id})
         SET person.ownerId = $ownerId, person.name = item.name, person.nameKey = toLower(item.name)
         WITH DISTINCT project
         UNWIND $facts AS item
         MERGE (fact:Fact {id: item.id})
         SET fact.ownerId = $ownerId, fact.projectId = $projectId,
             fact.kind = item.kind, fact.text = item.text,
             fact.status = 'confirmed', fact.confirmedAt = $now
         MERGE (project)-[:HAS_FACT]->(fact)
         WITH DISTINCT project
         UNWIND $supports AS link
         MATCH (fact:Fact {id: link.factId, projectId: $projectId})
         MATCH (source:Source {id: link.sourceId, projectId: $projectId})
         MERGE (fact)-[:SUPPORTED_BY]->(source)
         WITH DISTINCT project
         UNWIND $owners AS link
         MATCH (fact:Fact {id: link.factId, projectId: $projectId})
         MATCH (person:Person {id: link.personId, ownerId: $ownerId})
         MERGE (fact)-[:OWNED_BY]->(person)
         WITH DISTINCT project
         UNWIND $dependencies AS link
         MATCH (fact:Fact {id: link.factId, projectId: $projectId})
         MATCH (dependency:Fact {id: link.dependencyId, projectId: $projectId})
         MERGE (fact)-[:DEPENDS_ON]->(dependency)`,
        {
          ownerId: ids.owner,
          projectId: ids.northstarProject,
          now,
          sources: [
            {
              id: ids.northstarReviewPlan,
              title: "Executive review plan",
              text: "Priya Shah consolidates leadership feedback for the Northstar keynote video. The CEO review is October 7, 2026 at 11:00 AM Pacific, comments are due in Frame.io by 1:00 PM, and picture lock is 5:00 PM that day. The budget includes one consolidated revision round; late copy changes move to the backup version.",
            },
            {
              id: ids.northstarVendorPlan,
              title: "Post-production vendor and budget",
              text: "Lighthouse Post quoted $8,400 under purchase order NS-204 for color, sound mix, and one revision. Simone Brooks must release the purchase order by September 30. The studio slot is October 8 at 9:00 AM Pacific; missing it moves the mix to October 12 and puts the event handoff at risk.",
            },
            {
              id: ids.northstarDeliveryPlan,
              title: "Event delivery specification",
              text: "Lucas Park will package a 4K ProRes 422 HQ master, a 1080p H.264 backup, a 48 kHz WAV split, and WebVTT captions. Accessibility and technical QC are due October 9 at noon Pacific. Theo Martin will run the LED-wall playback test at Harbor Convention Center on October 10 at 3:00 PM. Delivery uses an encrypted SSD with a checksum manifest.",
            },
            {
              id: ids.northstarRiskLog,
              title: "Northstar production risk log",
              text: "The Forward Motion music license must clear by October 3. The approved product UI capture from build 6.4 is due October 2. The customer quote, product capture, purchase order, and fixed post-production slot are the four schedule risks. The no-quote backup cut protects the event date if legal approval slips.",
            },
          ],
          people: [
            { id: ids.priya, name: "Priya Shah" },
            { id: ids.simone, name: "Simone Brooks" },
            { id: ids.lucas, name: "Lucas Park" },
            { id: ids.theo, name: "Theo Martin" },
          ],
          facts: [
            { id: ids.executiveReview, kind: "deadline", text: "The CEO review is October 7, 2026 at 11:00 AM Pacific, with consolidated comments due by 1:00 PM." },
            { id: ids.feedbackRound, kind: "decision", text: "The production budget includes one consolidated leadership revision round." },
            { id: ids.pictureLock, kind: "deadline", text: "Picture lock is October 7, 2026 at 5:00 PM Pacific." },
            { id: ids.soundMix, kind: "dependency", text: "Lighthouse Post is reserved for color and sound mix on October 8, 2026 at 9:00 AM Pacific." },
            { id: ids.purchaseOrder, kind: "dependency", text: "Purchase order NS-204 for $8,400 must be released by September 30 to hold the post-production slot." },
            { id: ids.simoneResponsibility, kind: "responsibility", text: "Simone Brooks owns release of purchase order NS-204." },
            { id: ids.deliveryPackage, kind: "decision", text: "The event package includes a 4K ProRes master, 1080p H.264 backup, 48 kHz WAV split, WebVTT captions, and a checksum manifest." },
            { id: ids.accessibilityQc, kind: "deadline", text: "Accessibility review and technical quality control are due October 9, 2026 at noon Pacific." },
            { id: ids.lucasResponsibility, kind: "responsibility", text: "Lucas Park owns final packaging, captions, accessibility review, and checksum verification." },
            { id: ids.venuePlayback, kind: "deadline", text: "The LED-wall playback test is October 10, 2026 at 3:00 PM at Harbor Convention Center." },
            { id: ids.theoResponsibility, kind: "responsibility", text: "Theo Martin owns venue playback testing and event-team acceptance." },
            { id: ids.musicLicense, kind: "dependency", text: "The Forward Motion music license must clear by October 3, 2026." },
            { id: ids.productCapture, kind: "dependency", text: "The approved product UI capture from build 6.4 is due October 2, 2026." },
            { id: ids.priyaResponsibility, kind: "responsibility", text: "Priya Shah owns consolidated leadership feedback and the picture-lock decision." },
          ],
          supports: [
            { factId: ids.executiveReview, sourceId: ids.northstarReviewPlan },
            { factId: ids.feedbackRound, sourceId: ids.northstarReviewPlan },
            { factId: ids.pictureLock, sourceId: ids.northstarReviewPlan },
            { factId: ids.priyaResponsibility, sourceId: ids.northstarReviewPlan },
            { factId: ids.soundMix, sourceId: ids.northstarVendorPlan },
            { factId: ids.purchaseOrder, sourceId: ids.northstarVendorPlan },
            { factId: ids.simoneResponsibility, sourceId: ids.northstarVendorPlan },
            { factId: ids.deliveryPackage, sourceId: ids.northstarDeliveryPlan },
            { factId: ids.accessibilityQc, sourceId: ids.northstarDeliveryPlan },
            { factId: ids.lucasResponsibility, sourceId: ids.northstarDeliveryPlan },
            { factId: ids.venuePlayback, sourceId: ids.northstarDeliveryPlan },
            { factId: ids.theoResponsibility, sourceId: ids.northstarDeliveryPlan },
            { factId: ids.musicLicense, sourceId: ids.northstarRiskLog },
            { factId: ids.productCapture, sourceId: ids.northstarRiskLog },
            { factId: ids.northstarFallback, sourceId: ids.northstarRiskLog },
          ],
          owners: [
            { factId: ids.executiveReview, personId: ids.priya },
            { factId: ids.feedbackRound, personId: ids.priya },
            { factId: ids.pictureLock, personId: ids.priya },
            { factId: ids.priyaResponsibility, personId: ids.priya },
            { factId: ids.purchaseOrder, personId: ids.simone },
            { factId: ids.simoneResponsibility, personId: ids.simone },
            { factId: ids.accessibilityQc, personId: ids.lucas },
            { factId: ids.deliveryPackage, personId: ids.lucas },
            { factId: ids.lucasResponsibility, personId: ids.lucas },
            { factId: ids.venuePlayback, personId: ids.theo },
            { factId: ids.theoResponsibility, personId: ids.theo },
          ],
          dependencies: [
            { factId: ids.pictureLock, dependencyId: ids.executiveReview },
            { factId: ids.pictureLock, dependencyId: ids.northstarLegal },
            { factId: ids.pictureLock, dependencyId: ids.productCapture },
            { factId: ids.soundMix, dependencyId: ids.pictureLock },
            { factId: ids.soundMix, dependencyId: ids.purchaseOrder },
            { factId: ids.soundMix, dependencyId: ids.musicLicense },
            { factId: ids.northstarDeadline, dependencyId: ids.soundMix },
            { factId: ids.accessibilityQc, dependencyId: ids.northstarDeadline },
            { factId: ids.venuePlayback, dependencyId: ids.accessibilityQc },
            { factId: ids.venuePlayback, dependencyId: ids.northstarDeadline },
          ],
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
