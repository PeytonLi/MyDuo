# MyDuo — Product requirements document

Version: 1.0. Status: proposed implementation baseline. Date: 2026-09-11.

## 1. Product and problem

MyDuo is a personal meeting copilot that remembers your project context and helps you participate. It listens to an explicitly enabled meeting, privately drafts useful contributions, and can speak an approved contribution through a visible AI participant.

During a meeting, people must listen, recall previous decisions, evaluate claims, and formulate a response at the same time. Someone can understand the subject but forget a dependency, struggle to phrase a question, or need time to check their notes. Searching while others speak can cause them to miss the next part of the discussion.

The problem we are solving is the gap between what a person could contribute with context and thinking time, and what they can contribute in the moment.

The initial audience is students, builders, and small project teams discussing work they already know. The first demonstration is a project planning meeting. Customer discovery has not yet validated market size, willingness to pay, or competitive advantage; those are outside this hackathon implementation.

## 2. Proposed solution

Combine a live meeting transcript with a small, user-confirmed knowledge graph and communication preferences. The user requests one of three forms of help:

1. **Help me answer:** draft a concise answer to a selected or recent question.
2. **Find supporting context:** retrieve a relevant fact, prior decision, dependency, or source.
3. **Suggest a question:** formulate a useful clarification about scope, ownership, evidence, timing, or an unresolved assumption.

The contribution appears in a private web panel. The user reads it, edits it, dismisses it, or selects **Speak to meeting**. ElevenLabs creates the voice, and Recall.ai carries it into the call.

“Thinks like you” means using your supplied context, priorities, tone, and examples of your writing. It is not a claim to reproduce a person's beliefs or judgment. The assistant should surface contrary evidence when appropriate, and should not invent support simply to agree with the user.

## 3. Value proposition

- Recover the reason behind a decision without searching through notes during the call.
- Turn an unclear concern into a specific, constructive question.
- Reduce the effort of composing a response while preserving the user's control over what is said.
- Make supporting evidence inspectable, so the user can judge whether a suggestion applies.

The distinguishing demonstration is the connection between personal memory, present discussion, and an approved spoken contribution. Speech alone does not establish this value.

## 4. Goals, scope, and exclusions

### Required MVP

| ID | Requirement | Observable acceptance |
| --- | --- | --- |
| R01 | Private operator access | An unauthenticated visitor cannot read notes, transcripts, suggestions, or issue meeting commands. |
| R02 | Minimal personal profile | User can save role, priorities, preferred tone, and up to three short response examples; these influence generation. |
| R03 | Confirmed memory with evidence | User can paste a titled note, create/edit structured project facts referencing it, and mark a source as allowed for meeting use. |
| R04 | Meeting lifecycle | A validated Meet link starts one visible bot; joining, waiting, listening, failed, and ended states are shown. |
| R05 | Live transcript | Committed utterances appear with available speaker labels and timestamps; duplicate events do not duplicate text. |
| R06 | Answer assistance | A selected question or recent context produces a short, editable draft with valid evidence references or an explicit missing-context result. |
| R07 | Supporting context | User can retrieve related decisions/dependencies and inspect their sources. |
| R08 | Clarification assistance | User can request a concise question grounded in ambiguity in the current conversation. |
| R09 | Private suggestion controls | User can inspect sources, edit, dismiss, refresh, and explicitly approve a contribution. |
| R10 | Approved speech | Only the approved text version can be played; repeated clicks do not enqueue duplicate speech. |
| R11 | Stop and end | User can stop pending/current speech and end the bot session; UI distinguishes requested actions from confirmed outcomes. |
| R12 | Recoverable failures | Missing credentials, blocked admission, stale context, database/provider failure, and playback failure have explicit states. |
| R13 | Demo evidence | A reproducible fixture and a completed live-call acceptance run demonstrate all three assistance modes. |

### Deliberate MVP boundaries

- One operator identity, one active meeting, one selected project, English, and desktop Chrome/Edge.
- A companion web window; native meeting sidebars are not necessary for the first demo.
- User-triggered suggestions. No continuous inference on every partial transcript update.
- Pasted text and structured fact entry. Seed data is supported; arbitrary PDF ingestion, cloud-drive sync, and automatic knowledge extraction are deferred.
- A standard ElevenLabs voice. User-authorized voice cloning is optional future work.
- One LLM provider, one graph database, and one Next.js application.

### Stretch goals, in order

1. Automatically surface one private clarification suggestion after a completed conversational turn, with throttling and dismissal memory.
2. Embed the existing private panel in a Google Meet add-on.
3. Save reviewed decisions after the meeting.
4. Add another meeting platform or voice personalization after the existing flow remains reliable.

Fully autonomous interruptions, multi-agent debate, live web research, calendar integration, billing, multi-tenant account management, and a complete digital personality are excluded from this build.

## 5. Core user journey

### Before the meeting

The operator signs in, selects a project, and reviews a short profile. They paste a note or load the clearly labeled fictional demo dataset, then confirm the relevant decisions, dependencies, and owners. A source is private by default. The operator explicitly enables meeting use for material that can inform suggested spoken contributions.

The operator pastes a Google Meet URL and confirms participants are aware the AI assistant will listen. MyDuo shows connection readiness before joining. The participant is named clearly, for example “MyDuo — AI assistant.” The host may need to admit it.

### During the meeting

The panel shows bot status, the recent transcript, and a selected assistance mode. The operator can select a transcript utterance or enter a short clarification such as “Help me explain the deadline.” The backend retrieves relevant confirmed memory and creates a suggestion.

Only one current suggestion needs prominent placement. The card includes the triggering question, proposed text, evidence, generation time, and controls. A small history can retain recent cards without becoming a second chat application.

Example layout:

```text
MYDUO                       Listening

Question from Alex
“Can we launch this Friday?”

Suggested answer
“Friday could work for an internal preview.
The public launch still depends on the security review.”

Evidence: Tuesday planning notes · confirmed decision

[Speak to meeting]  [Edit]  [Dismiss]
[Help me answer] [Find context] [Suggest a question]

[Stop speaking]                         [End session]
```

Editing produces a new suggestion version. Approval binds to that exact version and text. New conversation arriving while generation is running must not silently replace the user's selected question or edit.

The user can also simply read the draft and speak themselves. No voice generation is necessary in that case.

### Ending the meeting

End session cancels pending speech, requests bot removal, revokes bot-page access, and stops new assistance requests. The panel reports whether the provider has confirmed departure. The operator can clear session data; provider-held recordings require separate deletion handling described in the architecture and test plan.

## 6. Suggestion behavior

### Answers

Return two or three short sentences, targeting no more than 60 words. Use project-specific facts only when supported by retrieved, confirmed memory or identified meeting utterances. A source link is evidence provenance, not a guarantee that the text is true.

If the answer is missing, say what information is missing and offer a question the user could ask. Never manufacture a deadline, approval, owner, or commitment. General phrasing help is allowed without pretending it came from the knowledge graph.

### Supporting context

Return a small number of relevant facts with source excerpts and dates. Where two sources conflict, present the disagreement instead of silently selecting a convenient claim. Preserve the distinction between a proposal, a confirmed decision, and a superseded decision.

### Clarifying questions

Target one question under approximately 30 words. Questions should identify a meaningful ambiguity: internal versus public launch, who owns a dependency, what “done” means, or what evidence supports an assumption. Do not repeatedly ask something already resolved in the recent transcript.

### Evidence and personalization

Each evidence reference must resolve to an actual retrieved source or utterance. Source IDs fabricated by the model are rejected. The UI uses factual labels such as “Supported by notes,” “Based on this meeting,” or “Needs context”; it does not display invented confidence percentages.

Preferences shape style, not factual certainty. Private sources are available for the user's own inspection but excluded from generation context in this MVP. This simple boundary prevents relying on a prompt alone to keep private facts out of spoken drafts.

## 7. Private versus public surfaces

The companion panel contains the operator's drafts, evidence, and controls. The bot's media webpage displays only a simple public identity/status tile and plays approved speech. It never renders private drafts or source notes.

The operator panel and media page have different permissions. Possession of a bot media credential must not grant access to the private panel or memory.

Screen sharing can expose otherwise private UI. Explain this once in the meeting setup experience and avoid claiming that the app is invisible to screenshots or screen sharing.

## 8. Architecture and stack summary

| Layer | Selection | Reason |
| --- | --- | --- |
| Application | Next.js App Router, React, TypeScript | One codebase for private UI, bot media page, and backend routes. |
| Package management | pnpm with pinned version and lockfile | Reproducible local and integration installs. |
| Runtime | Node.js 24 LTS baseline | Shared server runtime; validate exact versions in setup. |
| UI | CSS Modules/global CSS and native form controls | Sufficient for a compact accessible panel without a component framework. |
| Database | Neo4j AuraDB and official JavaScript driver | Confirmed project memory, evidence relationships, and durable session state. |
| Meeting transport | Recall.ai | Bot admission/lifecycle, live transcripts, and audio delivery into Meet. |
| Transcription | ElevenLabs Scribe v2 Realtime through Recall | Uses the existing provider integration. |
| Generation | DeepSeek Chat Completions API, one configurable JSON-output model | Produce bounded suggestions and evidence IDs; model availability validated during setup. |
| Voice | ElevenLabs text-to-speech | Speaks exactly the operator-approved text. |
| Live UI updates | Authenticated HTTP polling | Avoids a separate realtime messaging service for one active session. |
| Verification | ESLint, TypeScript, Node assertions through tsx, manual live-call matrix | Small runnable checks for meaningful logic plus actual integration evidence. |
| Demo hosting | One Render Web Service running the Next.js Node server | Provides the stable HTTPS origin required by the private panel, webhooks, and bot media page. |

Detailed choices, dependencies, endpoint contracts, and provider references live in [Architecture](ARCHITECTURE.md). Model names and package patch versions must be recorded after real setup; this document does not claim account access has been tested.

## 9. Quality targets

These are engineering targets to measure in Phase 3, not existing performance claims.

| Measure | Initial target | Measurement boundary |
| --- | --- | --- |
| Private draft latency | Median at most 5 seconds across 10 requests | Assistance request accepted to complete draft visible. |
| Approved speech latency | Median at most 4 seconds across 10 short responses | Approval accepted to first audio heard by a second participant. |
| Stop latency | At most 2 seconds in healthy connection tests | Stop selected to audio cessation heard by second participant. |
| Grounding | Every displayed evidence ID resolves | Automated reference validation and manual relevance review. |
| Speech authorization | Zero unapproved or duplicate utterances in acceptance cases | Include repeated clicks, retries, edits, and page reload. |
| Usability | All three modes completed without developer tools | Keyboard-accessible panel; source and action states understandable. |
| Live repeatability | Three consecutive short rehearsals succeed | Join, transcript, suggestion, approved speech, and leave. |

Measure transcription delay separately; missing partial transcript events and natural end-of-turn detection contribute to perceived latency. Report observed median and maximum, including failures, rather than quoting a vendor's model-only latency as end-to-end performance.

## 10. Risks and mitigation

| Risk | First response | Boundary/fallback |
| --- | --- | --- |
| Bot cannot enter the target meeting | Validate admission in Phase 1 using the actual demo account | Change meeting settings/account if allowed; browser simulation is labeled a partial demo. |
| Speech output has excessive delay | Prove playback early, keep answers short, preselect voice | Streaming optimization after a working baseline. |
| Incorrect or outdated memory | Confirm facts, retain dates and source status | Return uncertainty/conflict rather than a made-up answer. |
| Talking over participants | Explicit operator approval, visible playback, stop control | Automatic floor-taking is outside MVP. |
| Webhook outage or duplicate delivery | Fast verified writes, idempotent ingestion, health state | Reconnect/recreate bot if delivery cannot recover; never show false Listening status. |
| Integration work diverges | Freeze shared contracts before parallel work | One integration owner controls shared files. |
| Provider spend or quotas | One active bot, bounded prompts/text, timeouts, visible failure | Track usage during rehearsal; no invented budget or pricing assumption. |
| Public URL exposes private context | Operator authentication, scoped bot token, signed webhooks | Public demo is not ready until negative access tests pass. |

## 11. Execution and completion

Implement in the user's requested sequence:

1. [Setup](phases/01-SETUP.md): environment, security boundary, contracts, and a working live audio connection.
2. [Feature work](phases/02-FEATURES.md): independent tracks with bounded submissions and early vertical integration.
3. [Final integration and testing](phases/03-INTEGRATION-TESTING.md): complete the real user journey, failure testing, and hackathon materials.

The MVP is complete when R01–R13 have evidence in the acceptance record and the live demonstration works. A written plan, working mock, successful build, or browser-only voice demo is not sufficient by itself.

## 12. Open inputs

The next session can proceed with the baseline while collecting the hackathon deadline, team size, event rules, available API credits, preferred voice, and actual demo account. Credentials belong in local/server configuration, never in these documents. Paid service provisioning or public publishing should follow the user's implementation authorization and available account constraints.
