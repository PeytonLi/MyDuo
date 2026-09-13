# MyDuo technical excellence implementation plan

Status: implementation in progress  
Owner: MyDuo hackathon team  
Target: a judge-ready graph reasoning and live voice demonstration

## 1. Outcome

MyDuo will turn a live meeting question into an evidence-grounded answer by combining the current transcript with a Neo4j dependency graph. The operator will see the facts and graph path behind the draft, approve the exact wording, and hear it delivered only when the conversational floor is clear. Every generation will produce a trace that can be replayed and measured.

The success criterion is not the number of services connected. A judge must be able to watch Neo4j change the answer, inspect the supporting path, see the bot respect human speech, and verify the result with recorded quality and latency metrics.

## 2. What already exists

| Capability | Existing implementation | Plan |
| --- | --- | --- |
| Meeting participation and transcript | Recall bot, signed webhooks, durable utterances | Reuse; add participant speech events |
| Private drafting | Three assistance modes and selected response targets | Reuse; add graph tools and reasoning paths |
| Project memory | Neo4j sources, confirmed facts, owners, dependencies | Extend with temporal state and conflicts |
| Safe speech | Explicit approval, idempotent command, Stop handling | Reuse; stream audio and add floor gating |
| Learning signal | Generated and approved wording are saved | Retrieve examples by project, mode, and context |
| Test suite | Unit, Neo4j integration, provider, and Playwright checks | Add graph-answer evals and latency traces |

## 3. Target architecture

```text
Recall transcript + speech events
              |
              v
      trigger and intent gate
              |
              v
       DeepSeek tool planner
              |
       fixed application tools
       /         |          \
 search facts  trace graph  find conflicts/owners
       \         |          /
              Neo4j
                 |
        allowlisted evidence path
                 |
        DeepSeek grounded answer
                 |
   private draft + graph + technical trace
                 |
            human approval
                 |
       ElevenLabs audio stream
                 |
      Recall Output Media page
                 |
     outcomes and edits -> Neo4j
```

The model may choose among fixed tools and validated parameters. It may not author Cypher, approve speech, mutate confirmed memory, or fetch arbitrary URLs.

## 4. Delivery phases

### Phase 1: measurement contract and graph reasoning

1. Extend the suggestion contract with a bounded `reasoningPath`, `toolCalls`, `learnedFromCount`, and trace summary.
2. Add fixed Neo4j operations:
   - `search_project`: ranked project facts and sources.
   - `trace_dependencies`: bounded traversal from allowlisted fact IDs.
   - `find_conflicts`: active same-kind or semantically matching facts.
   - `get_owners_and_deadlines`: owners and deadline facts connected to the result.
3. Let DeepSeek select these tools through function calling, with a maximum number of rounds and arguments validated by Zod.
4. Generate the final answer from only the transcript snapshot and tool results.
5. Persist one `GenerationTrace` for success or failure.
6. Show the evidence path and timing in the private draft.

Acceptance:

- A dependency question returns a path with valid fact/source IDs owned by the current project.
- A forged model ID or unsupported tool argument is rejected.
- No model-generated Cypher is executed.
- A generation timeout leaves a visible failed trace and does not create a draft.
- Existing manual and automatic suggestion behavior still passes.

### Phase 2: temporal and contradiction-aware memory

1. Give confirmed facts `validFrom`, optional `validTo`, and an explicit active/superseded state.
2. During review, compare a proposed fact with active same-project facts of the same kind.
3. Return candidate conflicts to the operator with the supporting source for each side.
4. Add an explicit accept mode:
   - Keep both facts when they describe different subjects.
   - Supersede selected facts when the new statement replaces them.
5. Create `SUPERSEDES` and `CONTRADICTS` relationships and close superseded facts atomically.
6. Exclude superseded facts from ordinary retrieval while retaining them in the technical trace.

Acceptance:

- Replacing a deadline closes the old fact and creates one active replacement in a single transaction.
- Retrying acceptance is idempotent.
- Cross-project or cross-owner facts cannot be superseded.
- The next suggestion uses the replacement and can display the historical path.

### Phase 3: streaming and floor-aware speech

1. Subscribe the Recall bot to participant speech start/stop events.
2. Verify, normalize, and persist floor state with a monotonic revision and timestamp.
3. Require a short quiet window before a queued command starts playback.
4. Proxy the ElevenLabs streaming response through the protected audio route without buffering the full file.
5. Read and play the stream incrementally in the Output Media page using browser-native media primitives supported by the page runtime.
6. Keep polling Stop state during preparation and playback. A human speech event pauses or cancels according to a single documented state rule.
7. Record approval-to-first-audio, interruptions, and completion.

Acceptance:

- Speech cannot start while a participant is marked active.
- A late or duplicated speech event cannot rewind floor state.
- Stop prevents late playback during synthesis and streaming.
- If streaming is unsupported by the Output Media browser, the client falls back to the current complete-audio path and reports that fallback in the trace.

### Phase 4: contextual personalization and meaningful triggers

1. Link each approved edit to project, mode, response targets, evidence kinds, and outcome.
2. Retrieve only the most relevant recent examples instead of the latest three globally.
3. Expose `learnedFromCount` without claiming that the model was trained.
4. Replace timer-only automatic drafting with a deterministic trigger gate:
   - direct question;
   - explicit contradiction;
   - dependency or schedule risk;
   - missing owner or deadline.
5. Save `whyNow` on automatic suggestions and display it privately.
6. Never auto-approve or auto-speak.

Acceptance:

- Irrelevant transcript churn does not create an automatic draft.
- A clear question or newly stated blocker creates at most one draft per revision.
- Dismissal suppression remains effective.
- Personal examples never cross owner or project boundaries.

### Phase 5: evaluation and judge-facing trace

1. Add a replayable evaluation fixture format containing transcript, graph setup, expected evidence, and expected graph relationships.
2. Ship at least 20 realistic cases spanning questions, blockers, date changes, ownership, ambiguous requests, and unsupported answers.
3. Calculate:
   - evidence precision and recall;
   - unsupported-claim rate;
   - draft acceptance and edit distance;
   - generation p50/p95;
   - approval-to-first-audio p50/p95.
4. Add a meeting-level technical trace drawer showing the latest graph path, fixed tools, evidence, timings, and token/cache usage when the provider returns it.
5. Add a small evaluation summary to the home or review experience for demo mode.

Acceptance:

- Evaluations run from one pnpm command without calling live providers by default.
- Trace data is bounded and contains no provider secrets or audio bytes.
- Failed generations and cancelled speech remain measurable.
- The browser tests verify the graph path, conflict decision, trigger explanation, and trace drawer.

### Phase 6: integration, regression, and deployment verification

1. Run formatting, type checking, lint, unit, isolated Neo4j integration, production build, and Playwright checks.
2. Run live provider checks separately so ordinary regression remains deterministic.
3. Seed a coherent fictional production-delivery graph with a deadline conflict and at least one three-hop dependency path.
4. Deploy to Render and confirm health, webhook delivery, graph reasoning, floor-aware speech, Stop, meeting end, and review supersession.
5. Record the measured demo path in `docs/ACCEPTANCE-RESULTS.md` and update the demo guide.

## 5. Data additions

| Node or relationship | Key fields |
| --- | --- |
| `GenerationTrace` | id, ownerId, projectId, sessionId, suggestionId, status, trigger, model, startedAt, completedAt, totalMs, retrievalMs, generationMs, inputTokens, outputTokens, cacheHitTokens, toolCallsJson, evidenceIds, reasoningPathJson, errorCode |
| `Fact` additions | validFrom, validTo, status, subjectKey |
| `SUPERSEDES` | createdAt, reviewCandidateId |
| `CONTRADICTS` | detectedAt, reason, resolution |
| `EditExample` or suggestion additions | mode, projectId, targetKinds, editDistance, outcome |
| `Session` additions | floorRevision, activeSpeakerCount, floorUpdatedAt |

All IDs sent to the model are revalidated against the captured project snapshot before storage or display.

## 6. API and UI changes

| Surface | Change |
| --- | --- |
| Session state | Add current floor state and the latest trace summary |
| Suggestion response | Add reasoning path, tool summaries, trigger explanation, and personalization count |
| Review candidate | Add possible conflicts and explicit supersession selection |
| Recall realtime webhook | Accept participant speech events in addition to transcript events |
| Protected audio route | Stream provider bytes and preserve cancellation checks |
| Meeting panel | Add Evidence path and Technical trace disclosure panels |
| Review page | Add conflict comparison and replacement controls |
| Evaluation script | Replay fixtures and emit JSON plus readable summary |

## 7. Failure modes

| Failure | Handling | Required test |
| --- | --- | --- |
| Model requests an unknown tool | Reject the call and fail visibly | Unit |
| Model supplies a fact from another project | Allowlist removes it | Integration |
| Neo4j traversal grows unexpectedly | Maximum depth and result count in fixed query | Integration |
| Two reviews supersede the same fact | Transaction state predicate lets one win | Integration |
| Recall speech events arrive out of order | Ignore revisions/timestamps older than current state | Unit + integration |
| ElevenLabs stream fails after headers | Media page reports failed and releases command | Browser + integration |
| Stop races with first audio | Abort signal plus final command-state check | Integration + browser |
| Trace persistence fails | Suggestion still fails visibly; no silent untraced success | Integration |
| Personal examples leak projects | Owner and project predicates on every query | Integration |
| Trigger gate fires repeatedly | Transcript-revision reservation remains atomic | Integration |

## 8. Parallel workstreams

| Lane | Modules | Dependencies |
| --- | --- | --- |
| A | Graph retrieval, generation, contracts, suggestion tests | Existing memory model |
| B | Review extraction, temporal facts, conflict UI/tests | Existing review flow |
| C | Recall events, speech service, media page/tests | Existing command state machine |
| D | Trace UI, eval runner, trigger explanation, final integration | A, B, and C contracts |

Launch A, B, and C in parallel. Integrate and run the full suite before D binds their outputs into one operator experience.

## 9. Definition of done

- The graph path materially changes at least one generated answer.
- Every claim shown as grounded maps to an allowlisted utterance or source.
- Facts can be replaced without deleting history.
- Approved speech streams when the floor is clear and still obeys Stop.
- Automatic drafting explains why it appeared and does not speak automatically.
- Personalization is project-scoped and reports its evidence count.
- Every generation and speech attempt has a bounded trace.
- The deterministic regression and evaluation suites pass.
- The deployed two-person demo passes from meeting join through post-meeting memory update.

## 10. Not in scope

- A separate vector database; Neo4j remains the single data store.
- Free-form model-authored Cypher; fixed tools are easier to secure and evaluate.
- Fine-tuning; retrieval from approved edits is explainable and reversible.
- A multi-agent runtime; one bounded tool loop is enough for this interaction.
- Automatic speech approval; the operator remains responsible for every spoken word.
- More meeting platforms; they do not improve the central technical proof.

