# MyDuo hackathon demo

Use the **Northstar Summit keynote video** project. It is fictional and separate from MyDuo, so the meeting feels like a real production check-in.

## What Neo4j already knows

- The keynote video is 90 seconds and centers on an Orion Health customer story.
- The final cut is due October 8, 2026 at 2:00 PM Pacific.
- The final cut depends on legal approval of the customer quote by October 6 at noon.
- Maya Chen owns the final edit and backup cut.
- Elena Ruiz owns legal approval.
- If legal misses the cutoff, the team uses the backup cut without the quote.

The repeatable seed is in `scripts/seed.ts`. Run `pnpm seed` whenever the demo database needs to be restored.

## Five-minute demo

### 1. Show the graph — 30 seconds

Open Neo4j Query and run:

```cypher
MATCH (project:Project {id: '66666666-6666-4666-8666-666666666666'})-[:HAS_FACT]->(fact:Fact)
OPTIONAL MATCH (fact)-[:SUPPORTED_BY]->(source:Source)
OPTIONAL MATCH (fact)-[:OWNED_BY]->(owner:Person)
OPTIONAL MATCH (fact)-[:DEPENDS_ON]->(dependency:Fact)
RETURN project, fact, source, owner, dependency
```

Say: “MyDuo does not treat memory as one transcript blob. Neo4j connects the deliverable to confirmed decisions, owners, deadlines, dependencies, and the notes that support them.”

### 2. Start the meeting — 30 seconds

Choose **Northstar Summit keynote video**, paste the meeting link, confirm participant consent, and start MyDuo. Admit the visible bot.

Ask a teammate to say:

> Maya’s edit is nearly done, but legal has not cleared the customer quote. Are we still safe for the final handoff?

### 3. Draft a grounded answer — 90 seconds

1. Select that transcript line.
2. Choose **Help me answer**.
3. Enter: `State the deadline, owner, biggest dependency, and fallback.`
4. Select **Draft**.
5. Open the evidence under the draft before speaking.

A good result should explain that the October 8 handoff depends on Elena’s October 6 legal approval, Maya owns the edit, and the backup cut removes the quote.

Say: “The selected line is what I am responding to. My instruction tells MyDuo what my answer should emphasize. The answer is grounded in connected Neo4j memory, and nothing is spoken yet.”

Edit a few words, then select **Speak to meeting**. Emphasize that ElevenLabs receives only the exact text you approved.

### 4. Turn ambiguity into a question — 60 seconds

Ask the teammate to say:

> Legal should get back to us soon.

Select that line, choose **Suggest a question**, and enter: `Turn “soon” into a firm commitment.`

The expected question is similar to: “Can we confirm who will approve the quote and the exact deadline for that decision?” Review it, then speak it.

Have the teammate answer:

> Elena will confirm by October 6 at 10:00 AM, two hours before the cutoff.

### 5. Grow the graph — 90 seconds

End the meeting and choose **Review meeting memory**. Accept only the proposed responsibility or deadline that accurately captures Elena’s new commitment. Edit it before accepting if needed.

Run the Neo4j query again. The accepted fact and its supporting meeting source now appear in the same project graph.

Say: “The meeting changed the graph only after I reviewed and accepted the candidate. The next meeting can use that confirmed commitment as evidence.”

## Demo safeguards

- Keep automatic suggestions off for the first run; enable them only after the manual path succeeds.
- Use one short approved sentence for the voice demo.
- Keep Neo4j Query open in another tab with the visualization query ready.
- Rehearse Stop while speech is playing and confirm another participant hears it stop.
- If the Meet side panel is not installed and tested, use the deployed companion window and omit the add-on from the pitch.
