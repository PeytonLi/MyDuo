# MyDuo hackathon demo

Demo MyDuo as a private meeting copilot for a fictional production team delivering the **Northstar Summit keynote video**. The seeded project contains six source documents, twenty confirmed facts, six people, and connected ownership and dependency relationships.

The core story is simple: MyDuo hears a question, combines the selected transcript with confirmed Neo4j memory, privately drafts an answer, and speaks only after the operator approves the exact words.

## Before the demo

1. Run `pnpm seed` to restore the Northstar data.
2. Open the deployed MyDuo workspace and select **Northstar Summit keynote video**.
3. Open Neo4j Query in another tab with both queries below ready to run.
4. Start a short Meet or Zoom call with one teammate and admit the visible MyDuo bot.
5. Keep **Auto-suggest questions** off until the manual flow succeeds.

The text field beneath the transcript is **Quick note**. It saves a candidate for review after the meeting. It does not steer the current AI draft and it is never spoken automatically.

## Neo4j opening

Run this overview query:

```cypher
MATCH (project:Project {id: '66666666-6666-4666-8666-666666666666'})-[:HAS_FACT]->(fact:Fact)
OPTIONAL MATCH (fact)-[:SUPPORTED_BY]->(source:Source)
OPTIONAL MATCH (fact)-[:OWNED_BY]->(owner:Person)
OPTIONAL MATCH (fact)-[:DEPENDS_ON]->(dependency:Fact)
RETURN project, fact, source, owner, dependency
```

Say:

> This is the team's working memory. Neo4j connects the deliverable to source notes, confirmed decisions, owners, deadlines, and dependencies. MyDuo can follow those relationships instead of searching one large transcript.

Then show the critical path:

```cypher
MATCH path = (handoff:Fact {id: '99999999-9999-4999-8999-999999999999'})-[:DEPENDS_ON*1..4]->(dependency:Fact)
RETURN path
```

The handoff connects to sound mix, picture lock, the purchase order, music licensing, product capture, legal approval, and executive review.

## Five-minute live script

### 1. Answer from project memory

Ask your teammate to say:

> Maya's edit is nearly done, but legal has not cleared the customer quote. Are we still on track for the October 8 handoff, and what is our fallback if legal slips?

When the sentence appears in the transcript:

1. Select that transcript line.
2. Choose **Help me answer**.
3. Select **Draft**.
4. Open the evidence beneath the private draft.

There is no instruction box. The selected transcript line identifies what MyDuo should answer, and the selected mode determines the kind of contribution. If nothing is selected, MyDuo uses the latest relevant conversation.

A good draft should mention that the handoff depends on Elena Ruiz's October 6 legal approval, Maya Chen owns the edit, and the team can use the backup cut without the quote.

Say:

> The answer came from the live question and the connected project memory. I can inspect its sources, edit the words, or dismiss it. Nothing reaches the call until I press Speak.

Make one small edit, choose **Save edit**, then choose **Speak to meeting**.

### 2. Find a precise project detail

Deselect the first transcript line by selecting it again. Ask your teammate to say:

> Before we finish, what files does the events team need, and who owns the delivery package?

Select that new line, choose **Find context**, and choose **Draft**. The response should identify Lucas Park and the 4K ProRes master, 1080p backup, WAV split, WebVTT captions, and checksum manifest.

This demonstrates that the same graph can answer a schedule question and then traverse to a different owner and deliverable without loading a new document.

### 3. Turn ambiguity into a useful question

Deselect the previous line. Ask your teammate to say:

> Legal should get back to us soon.

Select that line, choose **Suggest a question**, and choose **Draft**. A useful result should ask for the owner or exact approval time. Approve it if it is concise.

Have the teammate answer:

> Elena will confirm by October 6 at 10:00 AM, two hours before the cutoff.

### 4. Capture memory without interrupting the call

Keep the teammate's commitment selected. In **Quick note**, enter:

`Elena committed to confirm legal approval by October 6 at 10:00 AM.`

Choose **Capture**.

Say:

> This note is separate from speech. It is held as a pending memory candidate, with the selected transcript attached as evidence. It cannot affect a future meeting until I review and accept it.

### 5. Grow the graph

End the meeting and choose **Review meeting memory**. Find the captured commitment, confirm its type and wording, select **Save this memory**, and choose **Save accepted**.

Run the Neo4j overview query again. The accepted fact and its supporting meeting source now appear in the Northstar graph.

Say:

> The graph changed only after human review. The next meeting can use this confirmed commitment, along with the transcript evidence that supports it.

## What each control means

| Control | Meaning |
| --- | --- |
| Selected transcript lines | The part of the conversation MyDuo should focus on. Up to ten lines may be selected. |
| Help me answer | Draft a direct reply to the selected line or latest relevant question. |
| Find context | Draft a useful supporting detail from the meeting and confirmed project memory. |
| Suggest a question | Draft a concise clarification question. |
| Draft | Generate a private contribution. It does not speak. |
| Save edit | Store the operator's revised wording as a new draft version. |
| Speak to meeting | Send only the reviewed text to ElevenLabs and the meeting. |
| Quick note | Save a pending memory candidate for post-meeting review. It does not steer speech. |
| Auto-suggest questions | Privately offer occasional clarification questions. It never speaks automatically. |

## Backup questions

- “Who owns the purchase order, and what happens if it is late?”
- “Which approvals are blocking picture lock?”
- “When is the venue playback test, and who owns acceptance?”
- “What is the fallback if the customer quote is not approved?”
- “How many executive revision rounds are included in the budget?”
- “What could move the sound mix from October 8 to October 12?”
- “Who owns captions and accessibility review?”

## Demo safeguards

- Keep the approved spoken response to one or two sentences.
- Keep Neo4j Query open with the visualization query ready.
- Deselect old transcript lines before demonstrating a different request.
- Rehearse Stop while speech is playing and confirm the other participant hears it stop.
- Use the deployed companion window unless the Meet side panel has been installed and tested.
