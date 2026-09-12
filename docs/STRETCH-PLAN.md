# MyDuo stretch-feature plan

Prepared: 2026-09-12. This plan starts from the tested MVP at commit `a89ef64`.

## Progress — 2026-09-12

Phases 1, 2, 3, and 5 are code-complete with regression coverage in `pnpm check:all` (11 unit, 5 integration, 14 desktop/mobile browser tests, build, audit; provider smoke tests pass separately). Phase 4's prototype is code-complete — pairing codes, scoped add-on tokens, CSP, and the `/meet-addon` panel — pending the Google Cloud test deployment. Phase 0 and every live-meeting gate remain open until the Render deploy exists. See [QA results](QA-RESULTS.md) for the coverage detail.

## Goal and order

Build the features that make the demo feel proactive and useful without weakening the rule that only the operator can approve speech.

Recommended order:

1. Complete the real Google Meet baseline on Render.
2. Add automatic private clarification suggestions.
3. Add reviewed post-meeting decisions to memory.
4. Add curated voice personalization.
5. Prototype the Google Meet side panel.
6. Add a second meeting platform only if the earlier gates remain reliable.

This order supersedes the original stretch-goal order in the PRD. Current Google Workspace review rules make the add-on a larger and less predictable task than the product features around it.

## Non-negotiable boundaries

- Automatic suggestions remain private. They never enqueue speech.
- New transcript content invalidates an old approval exactly as it does today.
- Nothing becomes confirmed Neo4j memory without review and approval.
- Raw provider payloads, model output, meeting URLs, and add-on tokens remain validated at the server boundary.
- Every phase adds regression coverage to `pnpm check:all` and preserves the current green suite.
- No voice cloning in this plan. Curated stock voices provide personalization without introducing biometric consent and deletion work.

## Phase 0: deploy and prove the baseline

**Purpose:** remove the only unresolved dependency before adding more live behavior.

### Work

1. Deploy `render.yaml` and add the existing private environment values.
2. Set `APP_BASE_URL` to the final HTTPS origin and redeploy.
3. Configure Recall transcript and status callbacks to the deployed routes.
4. Run a two-person Google Meet through join, admission, transcript, manual draft, approval, remote ElevenLabs audio, Stop, and End.
5. Record transcript-to-draft and approval-to-audible latency.

### Gate

- Another participant hears the exact approved sentence once.
- Stop and End report the actual provider result.
- No stale or duplicate command plays.
- One successful run is enough to start stretch work; three consecutive runs are required before the final demo.

If this gate fails, fix the existing vertical flow before continuing. Stretch features would only make the failure harder to isolate.

## Phase 1: automatic private clarification suggestions

**User outcome:** after a completed conversational turn, MyDuo can quietly surface one useful question without requiring the operator to press Draft.

### Product behavior

- Add an **Auto-suggest questions** toggle in the meeting panel. Default it off until the operator enables it.
- After a committed transcript revision settles for 2.5 seconds, request at most one clarification draft.
- Never generate while a manual draft is being edited, another suggestion is ready, speech is active, the meeting is not listening, or auto-suggest is paused.
- Enforce a 20-second server-side cooldown and at least one new non-bot utterance.
- Let the operator dismiss, pause for the meeting, or use the suggestion. Dismissal suppresses the same transcript revision and the next two revisions.
- Keep the existing Edit, Speak, and stale-review checks. Automatic origin does not grant speech authority.

### Minimal implementation

- Extend `SuggestionDraft` with `trigger: "manual" | "auto"`.
- Store `autoSuggestEnabled`, `lastAutoSuggestionAt`, `lastAutoRevision`, and `autoMutedUntilRevision` on `Session`.
- Reuse `generateSuggestion`; add an automatic request path that atomically reserves the eligible revision before calling DeepSeek.
- Reuse the existing `dismissed` suggestion state to update `autoMutedUntilRevision`. Do not add embeddings or a separate preference service.
- Add a small debounce to `meeting-client.tsx`; the server remains the authority for cooldown and eligibility.

### Regression gate

- One transcript revision can create no more than one automatic suggestion.
- Duplicate polling or webhook delivery cannot bypass the cooldown.
- Dismissed content does not immediately return.
- A manual draft is never replaced by an automatic draft.
- Paused, stale, ended, or non-listening sessions do not generate.
- Automatic suggestions cannot reach ElevenLabs without the normal explicit approval request.

## Phase 2: reviewed post-meeting decisions

**User outcome:** when a meeting ends, the operator reviews proposed decisions, deadlines, dependencies, and owners before saving them as future context.

### Product behavior

- Show **Review meeting memory** after End is confirmed.
- DeepSeek extracts a short list of candidates with type, text, owner, and supporting transcript line IDs.
- Each candidate can be edited, accepted, or rejected. A batch **Save accepted** action commits only accepted items.
- Accepted items appear in the existing project memory and can support future meeting suggestions.

### Minimal implementation

- Add `ReviewCandidate` nodes linked to the ended `Session`, with `pending`, `accepted`, or `rejected` status and allowlisted utterance evidence IDs.
- Add `POST /api/sessions/[id]/review` for extraction and `PATCH /api/review-candidates/[id]` for edit/accept/reject.
- On acceptance, create one compact `Source` for that candidate containing the reviewed text and supporting transcript excerpts, then create the existing confirmed `Fact` linked to that source.
- Add `/meeting/[id]/review` rather than expanding the live meeting screen.
- Cap extraction input and candidates. Start with the most recent 100 non-bot utterances, 30,000 characters, and 10 candidates.

### Regression gate

- No confirmed `Fact` or meeting-usable `Source` exists before acceptance.
- Model-supplied evidence IDs outside the session are rejected.
- Editing changes the exact text that is saved.
- Rejected candidates never enter retrieval.
- Repeating extraction or acceptance is idempotent.
- A candidate from one operator, project, or session cannot be accepted into another.

## Phase 3: curated voice personalization

**User outcome:** the operator chooses how MyDuo sounds while retaining the same approval and media controls.

### Product behavior

- Offer three curated ElevenLabs voices with short labels and a fixed preview sentence.
- Save the selected allowed voice on the operator profile.
- Bind the selected voice ID to each `SpeechCommand` when it is approved, so a later profile change cannot alter queued speech.

### Minimal implementation

- Configure an allowlist of voice IDs and display names in one server environment value.
- Add an authenticated, rate-limited preview route with fixed text.
- Extend the profile UI with native radio controls and an audio preview.
- Change audio preparation to return the stored approved text and stored voice ID.

### Regression gate

- Arbitrary voice IDs are rejected server-side.
- Media credentials cannot request previews or change voices.
- A queued command uses its bound voice after a profile change.
- Preview and spoken-command audio remain private and uncached.

## Phase 4: Google Meet side-panel prototype

**User outcome:** the private suggestion controls can appear beside the call instead of in a separate browser window.

### Constraint discovered during planning

Google Meet web add-ons support a hosted `sidePanelUrl` and declared `addOnOrigins`. Google also requires the login flow to work without third-party cookies and says a reviewed add-on must not invite or rely on a bot in the meeting. MyDuo currently relies on a Recall participant for transcript and audio. Therefore:

- A private test deployment can pair with an already-running MyDuo session for the hackathon.
- Marketplace publication is not part of this phase.
- A publishable add-on needs standalone value or a different capture path before review.

### Time-boxed implementation

1. Create a Google Cloud Workspace Add-on test deployment with a `/meet-addon` side-panel URL on Render.
2. Reuse the existing meeting component in a narrow layout.
3. Avoid cookie-dependent authentication inside the iframe. Generate a short, one-use pairing code in the companion app and exchange it for a scoped add-on session.
4. Use the Meet Add-ons SDK only for meeting/add-on context and lifecycle. Keep Recall control in the existing backend.
5. Stop after two hours if test installation, account policy, or iframe authentication blocks progress; retain the working companion panel.

### Prototype gate

- The side panel loads in a real Meet test deployment with third-party cookies disabled.
- A pairing code can access only its selected session and expires after use.
- Transcript, draft, edit, approval, Stop, and End remain usable at side-panel width.
- No meeting data is exposed to other Meet participants through a collaborative activity.

## Phase 5: second meeting platform

Start this only after three consecutive Google Meet rehearsals pass. Prefer Zoom because Recall already provides the bot transport.

### Work

- Replace the Google-only URL validator with a small allowlist that detects Google Meet or Zoom.
- Store `meetingPlatform` on the session and keep the rest of the state machine unchanged.
- Adjust admission/error copy by platform.
- Run the same real acceptance path with a second participant.

### Gate

- Invalid or lookalike meeting hosts remain rejected.
- Google behavior is unchanged by the generalized validator.
- One real Zoom run proves join, transcript, approved speech, Stop, and departure.

## Parallel work and integration order

After Phase 0 passes, three bounded branches can proceed:

| Workstream | Owns | Must avoid |
| --- | --- | --- |
| Automatic suggestions | suggestion contracts, eligibility transaction, meeting panel | memory review and speech internals |
| Meeting review | review candidates, review routes/page, accepted memory writes | live suggestion scheduling |
| Voice choice | profile voice setting, preview, command-bound voice | suggestion generation |

The Meet add-on remains an isolated spike until its test deployment works. Merge automatic suggestions first, then meeting review, then voice choice. Run `pnpm check:all` after each merge and one real meeting after any change to transcript, speech, session, or Recall code.

## Final stretch acceptance

The stretch release is ready for the hackathon when:

- Three real Google Meet rehearsals pass.
- Automatic suggestions remain useful and quiet: no duplicate prompt, no manual-draft replacement, and no automatic speech.
- At least one reviewed decision from meeting A grounds a suggestion in meeting B.
- The selected stock voice is heard by another participant.
- The side panel is either demonstrated as a working private test deployment or clearly omitted; it is never represented as Marketplace-ready without meeting Google's publication rules.
- `pnpm check:all`, `pnpm test:providers`, and the production dependency audit pass on the final commit.
