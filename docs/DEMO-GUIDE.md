# MyDuo hackathon demo

Demo MyDuo as a private meeting copilot for a fictional production team delivering the **Northstar Summit keynote video**. The seeded project contains seven source documents, twenty-one confirmed facts, and connected ownership and dependency relationships.

The core story is simple: MyDuo hears a question, follows the Neo4j graph to gather evidence, privately drafts an answer with its full reasoning path visible, and speaks only after the operator approves the exact words — waiting for a clear moment on the call.

## Before the demo

1. Run `pnpm seed` to restore the Northstar data.
2. Open the deployed MyDuo workspace and select **Northstar Summit keynote video**.
3. Open Neo4j Query in another tab with the queries below ready to run.
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

> This is the team's working memory. Neo4j connects the deliverable to source notes, confirmed decisions, owners, deadlines, and dependencies. MyDuo does not search one large transcript — it calls fixed tools that traverse this graph, and it shows me the exact path it used.

Then show the critical path:

```cypher
MATCH path = (handoff:Fact {id: '99999999-9999-4999-8999-999999999999'})-[:DEPENDS_ON*1..4]->(dependency:Fact)
RETURN path
```

The handoff connects to sound mix, picture lock, the purchase order, music licensing, product capture, legal approval, and executive review.

## Three-minute full script (runs inside Google Meet)

Two windows side by side: Google Meet and the deployed workspace. The live demo happens in the Meet side panel; the workspace window is for the audit trail, review, and metrics.

**Setup (5 minutes before, none on camera):**

1. Start the Meet call. Teammate in. Admit the visible MyDuo bot.
2. Workspace window (normal browser tab): logged in, Northstar selected, **Auto-suggest off**, meeting page open.
3. In Meet: open **Activities → MyDuo** so the side panel is showing "Pair with your active session."
4. Neo4j tab: SUPERSEDES query (below) typed but **not run**.
5. Brief the teammate on their lines — each one appears in the script where they say it. Tell them: speak naturally, keep talking through sentence endings, otherwise stay quiet.

### Step 1 — The problem and the pairing (0:00–0:40)

**YOU SAY** (over the Meet view, teammate quiet):

> Every meeting produces decisions, deadlines, and commitments — and most of them evaporate. Transcripts sit unread, notes go stale, and current AI assistants either record everything into summaries nobody opens or interrupt whenever they feel like it. MyDuo is a private copilot for the person running the meeting: it listens, remembers in a graph you can audit, and only speaks the exact words I approve.

**YOU DO:** In the workspace window, click **Meet side panel** — a 10-letter code appears. Type it into the Meet panel and click **Pair panel**. The live transcript appears in the panel.

**YOU SAY:**

> MyDuo is a Google Meet add-on. I paired this panel with a one-use code from my workspace — it's mine alone, nobody else on the call can see it. Behind it is this team's working memory: a Neo4j graph of owners, deadlines, and dependencies, all linked to source documents.

### Step 2 — The core loop, inside Meet (0:40–1:45)

**TEAMMATE SAYS:**

> Maya's edit is nearly done, but legal hasn't cleared the customer quote yet. Are we still on track for the October 8 handoff — and what's our fallback if legal slips?

**YOU DO:** Watch it land in the panel transcript. In the panel, pick **Answer** → **Draft privately**.

**YOU SAY** (while it drafts, ~10 s):

> No prompt box — it heard the question. It's privately drafting from the project's memory graph, and nothing reaches the call.

**TEAMMATE SAYS** (slowly, trailing off — this is still while the draft is generating):

> I just don't want to promise the client a date we can't hit.

The draft appears with **Responding to** the teammate's question. It should name Elena Ruiz's October 6 legal approval, Maya Chen's edit, and the backup cut as the fallback.

**YOU SAY:**

> It grounded the answer in the graph — the approval owner, the date, the fallback plan.

**YOU DO:** Make one small edit in **Suggested words**. Click **Speak to meeting** while the teammate is still finishing their trailing sentence. Point at the wait.

**YOU SAY:**

> I control the exact words. And it waits for a clear moment — it will not talk over people.

The teammate finishes; the approved speech plays to the call.

### Step 3 — The audit trail (1:45–2:00)

**YOU DO:** Switch to the workspace window — same session, same draft. Open **Technical trace** beneath the draft.

**YOU SAY:**

> Same draft, full audit trail: which graph tools it called, the evidence hops, latency, even token counts. The model can't write its own database queries — it picks from four fixed tools.

### Step 4 — Capture the date change (2:00–2:20)

**TEAMMATE SAYS:**

> Also, heads up — the final video deadline moved from October 8 to October 9 at 2:00 PM.

**YOU DO:** In the workspace transcript, click that line. In **Quick note**, type `The final video is due October 9, 2026 at 2:00 PM Pacific.` Choose **Capture**.

**YOU SAY:**

> Captured with the transcript as evidence — but it's only a pending candidate. It changes nothing until a human accepts it.

### Step 5 — Supersede the old deadline (2:20–2:50)

**YOU DO:** **End session** → **Review meeting memory** → set the note's type to **Deadline** → check **Save this memory** → **Save accepted**. The conflict block appears — MyDuo flags the live October 8 deadline. Check the October 8 fact → **Replace selected** → switch to the Neo4j tab → run the pre-entered query.

**YOU SAY:**

> MyDuo caught the contradiction. The old deadline is closed, not deleted — linked to the new one with the evidence that justified the change. The next meeting answers from the new date.

### Step 6 — Receipts and close (2:50–3:00)

**YOU DO:** Home page, **Technical evidence** panel.

**YOU SAY:**

> Grounded drafts, graph hops per draft, approval rate, latency — measured from the traces of what you just watched. Not claims. Measurements. That's MyDuo — private memory, auditable reasoning, human-approved voice.

**If something goes off-script:**

- Panel won't pair → do everything in the workspace window; the flow is identical.
- "The meeting changed. Review this draft…" banner → click **Still relevant — review again** and say: "The conversation moved, so it asks me to confirm. Safety, not friction."
- No conflict block at step 5 → the note still saved; say the human-review line and skip the Neo4j query.
- Draft shows no tool calls → "The tools are optional — it answered from direct context here."
- Anything hangs → **End session** always works, and the review close is the strongest finish.

Cut from the six-minute script: the spoken Neo4j narration, the Find context and Suggest a question steps, and the Stop rehearsal. If you find 30 spare seconds, flash the pre-run critical-path query right before step 1.

## Six-minute live script

### 1. Watch the graph answer a dependency question

Ask your teammate to say:

> Maya's edit is nearly done, but legal has not cleared the customer quote. Are we still on track for the October 8 handoff, and what is our fallback if legal slips?

When the sentence appears in the transcript:

1. Select that transcript line.
2. Choose **Help me answer**.
3. Select **Draft**.

There is no instruction box. The selected transcript line identifies what MyDuo should answer. DeepSeek decides for itself whether to call the fixed graph tools — project search, dependency tracing, conflict lookup, or owner and deadline lookup — and the draft it returns is grounded in what those tools found.

Open **Technical trace** beneath the draft. It shows the tool calls it made, the Neo4j evidence path (fact → owner, fact → source, fact → dependency), the model, retrieval and generation timing, and token usage including cache hits.

Say:

> Every claim maps to a fact in the graph, and I can see the exact hops the model took to reach it. The model cannot write its own database queries — it picks from four fixed, validated tools.

A good draft should mention that the handoff depends on Elena Ruiz's October 6 legal approval, Maya Chen owns the edit, and the team can use the backup cut without the quote.

Make one small edit, choose **Save edit**, then choose **Speak to meeting**. If your teammate is still talking, the panel shows **Waiting for a clear moment…** — MyDuo will not talk over a participant. Approve while the floor is quiet and the response streams in.

### 2. Find a precise project detail

Deselect the first transcript line by selecting it again. Ask your teammate to say:

> Before we finish, what files does the events team need, and who owns the delivery package?

Select that new line, choose **Find context**, and choose **Draft**. The response should identify Lucas Park and the 4K ProRes master, 1080p backup, WAV split, WebVTT captions, and checksum manifest. Open **Technical trace** again to show a different tool path answering a different question from the same graph.

### 3. Turn ambiguity into a useful question

Deselect the previous line. Ask your teammate to say:

> Legal should get back to us soon.

Select that line, choose **Suggest a question**, and choose **Draft**. A useful result should ask for the owner or exact approval time. Approve it if it is concise.

Have the teammate answer:

> Elena will confirm by October 6 at 10:00 AM, two hours before the cutoff.

### 4. Capture a date change without interrupting the call

Ask your teammate to say:

> Also, heads up — the final video deadline moved from October 8 to October 9 at 2:00 PM.

Select that line. In **Quick note**, enter:

`The final video is due October 9, 2026 at 2:00 PM Pacific.`

Choose **Capture**.

Say:

> This note is separate from speech. It is held as a pending memory candidate, with the selected transcript attached as evidence. It cannot affect a future meeting until I review and accept it.

### 5. Review, resolve the conflict, supersede the old fact

End the meeting and choose **Review meeting memory**. Find the captured date change and set its type to **Deadline**.

Choose **Save accepted**. MyDuo detects that the new deadline conflicts with the active **October 8** fact and lists both side by side with their active-since dates.

Check the older fact and choose **Replace selected**.

Say:

> MyDuo will not silently keep two contradictory deadlines. It closes the old fact, links the new one with SUPERSEDES and CONTRADICTS, and keeps the full history — the old fact is excluded from future retrieval but never deleted.

Run this in Neo4j:

```cypher
MATCH (new:Fact)-[:SUPERSEDES]->(old:Fact)
OPTIONAL MATCH (new)-[:SUPPORTED_BY]->(source:Source)
RETURN new, old, source
```

The replacement fact, the closed October 8 fact, and the meeting transcript that justified the change all appear. The next meeting that asks about the handoff will answer from the new date.

### 6. Show measured behavior

Return to the home page. The **Technical evidence** panel shows measured metrics from the drafts just generated: the share of grounded drafts, average graph hops per draft, approval rate, median draft time, and median approval-to-voice latency.

Say:

> These are not claims — they are recorded measurements from the traces of the drafts you just watched.

## What each control means

| Control | Meaning |
| --- | --- |
| Selected transcript lines | The part of the conversation MyDuo should focus on. Up to ten lines may be selected. |
| Help me answer | Draft a direct reply to the selected line or latest relevant question. |
| Find context | Draft a useful supporting detail from the meeting and confirmed project memory. |
| Suggest a question | Draft a concise clarification question. |
| Draft | Generate a private contribution. It does not speak. |
| Save edit | Store the operator's revised wording as a new draft version. |
| Speak to meeting | Send only the reviewed text to ElevenLabs and the meeting, once the floor is clear. |
| Technical trace | The graph tools used, evidence path, model, timings, and token usage behind the draft. |
| Quick note | Save a pending memory candidate for post-meeting review. It does not steer speech. |
| Auto-suggest questions | Privately offer a draft when the meeting raises a question, risk, or date change. It explains why it appeared and never speaks automatically. |

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
- Keep Neo4j Query open with the visualization and SUPERSEDES queries ready.
- Deselect old transcript lines before demonstrating a different request.
- If the teammate is talking when you approve speech, point at **Waiting for a clear moment…** — that delay is the feature, not a failure.
- Rehearse Stop while speech is playing and confirm the other participant hears it stop.
- If DeepSeek does not call graph tools for a simple question, say the tools are optional and show the trace drawer on a dependency question instead.
- Use the deployed companion window unless the Meet side panel has been installed and tested.
