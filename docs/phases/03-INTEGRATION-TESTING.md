# Phase 3 — Final integration, testing, and demo

Status: local integration complete; public Google Meet acceptance is blocked on deployment. Results are in [ACCEPTANCE-RESULTS.md](../ACCEPTANCE-RESULTS.md).

The integration owner is responsible for proving the entire user journey. Individual track checks do not establish MVP completion. Rough allocation: reserve 6–10 hours, including time to fix integration failures and rehearse.

## I1. Assemble and verify the final state

1. Review every track completion note and reconcile shared-contract changes.
2. Install from the committed lockfile and run lint, typecheck, the core checks, and production build as distinct checks.
3. Start the production app with the actual public HTTPS origin. Verify callbacks and media URLs are not stale development addresses.
4. Confirm real providers are enabled and fixture mode is visibly disabled.
5. Confirm selected voice/model, Neo4j seed, access controls, and actual meeting admission work from the demo account.

Do not expand testing indefinitely after checks pass. Add or repeat checks when new edits, failures, or unresolved risks justify them.

## I2. End-to-end acceptance matrix

Record actual outcomes in `docs/ACCEPTANCE-RESULTS.md`. Each row needs pass/fail/blocked, date, tested version/commit when available, and concise evidence. Do not prefill successful results.

| Test | Requirements | Pass condition |
| --- | --- | --- |
| Operator privacy | R01 | Logged-out requests cannot read state/memory or create actions; private responses are not shared-cacheable. |
| Media authority | R01, R10 | Media token cannot read notes, generate suggestions, approve arbitrary text, or access another session. |
| Source setup | R02, R03 | Profile and confirmed notes survive reload; private sources stay excluded from generation. |
| Join and admission | R04 | Visible bot joins; waiting/denied states are understandable and retry does not spawn duplicate bots. |
| Transcript correctness | R05 | A spoken question arrives with available speaker/timing; duplicate delivery does not duplicate the utterance. |
| Answer from memory | R06 | Atlas launch answer uses the confirmed security dependency with an actual supporting source. |
| Supporting detail | R07 | Dependency, owner, and evidence can be inspected from the panel. |
| Clarifying question | R08 | Suggestion distinguishes internal preview versus public launch and is relevant to the current conversation. |
| Missing/conflicting context | R06–R08 | Missing facts are acknowledged; contradictory sources are surfaced without inventing a decision. |
| Edit then speak | R09, R10 | Second participant hears the exact edited and approved text once. |
| Repeated approval | R10 | Double click/retry with the same request ID produces one command and no duplicate playback. |
| Context/version change | R09, R10 | Changed draft or transcript requires fresh review; an old approval cannot speak changed text. |
| Stop while preparing | R11 | Cancelled generation cannot later start speaking. |
| Stop while speaking | R11 | Audio stops; requested/confirmed/error state reflects actual acknowledgement. |
| Media reload/ack loss | R10, R12 | Old speech is not replayed; uncertain outcomes remain explicit. |
| End session | R11 | Commands cancel, token revokes, bot departure is confirmed or clearly reported unresolved. |
| Provider/database failure | R12 | Timeout or unavailable service shows an actionable error; no silent success or fixture substitution. |
| Webhook tampering | R01, R05 | Invalid signature, wrong bot ID, or oversized payload cannot mutate session data. |
| Prompt injection | R06, R10 | A note/utterance requesting secret disclosure or automatic speech cannot bypass server authority. |
| Source/session deletion | R03, R12 | Deleted local content is inaccessible; affected drafts invalidate; provider deletion status is separately reported. |
| Keyboard and narrow layout | R09 | Operator can select modes, inspect evidence, edit, approve, stop, and end without a mouse. |

Use deterministic local checks for authority, deduplication, evidence validation, and state transitions. Use live calls for admission, transcription, remote audio, interruption, and timing. Do not assert exact wording from a probabilistic model.

## I3. Measure performance and reliability

Use the PRD's measurement boundaries. Record 10 assistance requests and 10 short speech approvals, plus healthy stop tests. Capture sample count, failures, median, and maximum; keep transcript lag separate from generation and playback.

If a target is missed:

1. Identify whether time is spent in transcript commitment, graph retrieval, model generation, audio synthesis/buffering, polling, or provider playback.
2. Make the smallest targeted fix. Shorten prompt/response limits before adding infrastructure.
3. If complete-audio buffering is the main cause, add ElevenLabs streaming playback in the existing media page and retest cancellation.
4. Record any remaining performance limitation honestly. A working demo with a known delay is different from a measured target pass.

Run three consecutive live rehearsals with fixture mode off. Remove each bot afterward so repeated testing does not leave active sessions or unnecessary charges.

## I4. Fix priorities and release gate

Fix before demo:

- Any private data exposure or unauthorized speech path.
- Duplicate bots/speech after retries or reloads.
- Wrong/unsupported project-specific claims presented as confirmed facts.
- Inability to complete join → transcript → draft → approve → remote speech → leave.
- Stop/end reporting success when the underlying state is unresolved.

Defer cosmetic refinements, native sidebar work, extra voices/platforms, and automatic intervention when they threaten these checks.

The final app must pass lint, typecheck, core checks, and production build after material fixes. Add one regression assertion for a fixed non-trivial bug when an existing check does not cover it.

## I5. Hackathon demonstration and submission preparation

Create `docs/DEMO-RUNBOOK.md` after the live flow exists. Target a three-minute demonstration:

1. **Problem (20 seconds):** explain the difficulty of remembering decisions and composing questions during a live conversation.
2. **Personal context (25 seconds):** show the fictional Atlas note and its confirmed dependency/owner in memory.
3. **Answer (45 seconds):** teammate asks about Friday launch; request a draft, open its source, edit, and approve spoken delivery.
4. **Clarification (35 seconds):** teammate uses ambiguous launch language; request and speak a clarifying question.
5. **Control and honesty (30 seconds):** show Stop and a missing-context result, then end the session.
6. **Architecture/value (25 seconds):** explain Neo4j memory, ElevenLabs speech, and the connection to the meeting.

Also prepare a recorded backup of a successful real run. If the live meeting fails, identify the backup as recorded. If only browser simulation works, identify that limitation; do not claim external meeting integration passed.

Draft hackathon materials only after checking the actual event's requirements: project description, architecture image, sponsor integration evidence, setup instructions, repository/demo links when they exist, known limitations, and video format/duration. The user has not supplied an event, deadline, submission portal, or team details.

Preparing materials is part of this phase. Sending messages to organizers, submitting forms, or publishing links requires the user's authorization for those external actions. Do not invent sponsor requirements or submit to an assumed event.

## Final deliverables and definition of done

- [ ] R01–R13 are mapped to recorded evidence.
- [ ] All must-fix issues are resolved; remaining limitations are explicit.
- [ ] Required code checks pass on the final source state.
- [ ] A second participant verified actual approved audio delivery.
- [ ] Three live rehearsals succeeded with real providers.
- [ ] Performance measurements and any target misses are documented.
- [ ] Setup instructions reproduce the app without committed secrets.
- [ ] Demo runbook and actual backup recording location are recorded.
- [ ] Provider sessions are stopped and cleanup state is known.
- [ ] Handoff points to actual results and remaining work rather than repeating the PRD.

The completion report should say what works, how it was verified, what remains limited, and where to find the artifacts. Do not label the project production-ready based on hackathon acceptance alone.
