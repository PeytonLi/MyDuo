# Phase 1 — Setup and live feasibility

Status: not started. Start only after the user requests implementation.

Read [PRD](../PRD.md) and [Architecture](../ARCHITECTURE.md) first. This phase owns the application foundation and proves the riskiest external connection before feature work begins.

## Entry conditions

- The planning documents are available in the working folder.
- Implementation has been authorized in a subsequent session.
- The developer can use a Google Meet test meeting and obtain the required service credentials. Never request credentials in a committed document.

No team size or event deadline is known. Estimate this phase at 4–8 focused hours after account access is available; this is a rough allocation, not a delivery promise.

## S1. Inspect and establish the project

1. Inspect the folder again, including applicable AGENTS.md instructions and uncommitted files. At planning time it was empty and not a Git repository; that may have changed.
2. Preserve `docs/` and any user files. Initialize Git locally if still needed as part of the authorized setup. Do not create a remote or publish anything merely because local setup started.
3. Verify Node and pnpm availability. Pin a compatible runtime and pnpm version.
4. Create a Next.js App Router application with TypeScript, ESLint, `src/`, and CSS Modules/global CSS. Use pnpm only. If the scaffold refuses an existing docs folder, scaffold in a checked temporary sibling location and copy only new application files into this folder; do not relocate/delete the planning documents.
5. Define `dev`, `build`, `start`, `lint`, `typecheck`, and `check:core` scripts. The core check runs the small assertion/contract checks as they are added.
6. Add a lockfile, `.gitignore`, `.env.example`, and a short root README with run instructions and a link to the docs index.

Deliverable: a locally runnable app with preserved planning documents and reproducible dependency installation.

## S2. Define shared contracts and fixtures

1. Implement the shared types and boundary schemas specified in Architecture section 6.
2. Add a fictional Project Atlas fixture: Tuesday planning note, public-launch decision, security-review dependency, owner Maya, and internal-preview distinction.
3. Add representative committed transcript/status payload fixtures after checking actual provider documentation. Mark fixtures clearly; do not include real meeting content.
4. Define the initial empty/error/loading/session/speech states that the UI and backend will exchange.
5. Assign one integration owner for shared contracts, package files, auth, database connection, and root layout.

Deliverable: one agreed contract used by UI mocks and backend functions. Do not create four different event shapes for four feature tracks.

## S3. Establish database and access boundaries

1. Connect to Neo4j with a server-only driver module and fixed parameterized queries.
2. Create the minimal uniqueness constraints for application IDs and deduplication keys; add an idempotent fictional seed command.
3. Implement operator login/session/logout and private-route authorization before exposing private content through the public Render service.
4. Establish the media bootstrap and restricted media authority shared with track D. A scoped media credential cannot read memory or approve speech.
5. Create separate signed webhook handlers for transcript/status requests. Verify actual account secrets and headers; invalid signatures cannot write to Neo4j.
6. Add one runnable negative check proving unauthenticated/operator-media boundary rejection and duplicate event identity handling. Extend the same small check entrypoint as logic is implemented.

Deliverable: a real database connection and basic authentication/verification boundaries, tested with synthetic inputs.

## S4. Verify provider access

Use server-side configuration; record only success/failure and non-secret settings in `docs/SETUP-RESULTS.md`.

| Provider | Required proof |
| --- | --- |
| Neo4j | Write/read the fictional seed and reconnect without duplication. |
| Recall | Create, inspect, and remove a test bot in the selected region. |
| ElevenLabs transcription | Recall delivers a committed transcript from the actual test meeting. |
| ElevenLabs voice | Selected voice/model generates a short valid audio response. |
| DeepSeek | Configured model returns valid JSON that passes the bounded suggestion schema using fictional context. |
| Render HTTPS | Recall can load the deployed media page and reach both webhook routes. The health check passes after deploy. |

Record exact package versions, model IDs, API region, account prerequisites, provider retention settings, and any tested limitations. Do not claim API access based only on a key being present.

## S5. Prove the vertical audio connection

This small spike is part of setup, not the full feature implementation:

1. Join a real Meet call with a visible MyDuo bot and two human endpoints if possible.
2. Say a short test question and observe a committed transcript arrive in the app.
3. Explicitly approve a fixed test sentence and have the bot's media page play its ElevenLabs audio.
4. Confirm a second participant hears it. Local playback in the operator window does not pass this check.
5. Exercise a basic stop and remove the bot. Validate whether the fragment-based media bootstrap survives provider loading.
6. Measure rough transcript and playback timing. Retain the smallest working code as the integration baseline.

Use Output Media for generated speech. Do not route conversational TTS through Recall's short-clip Output Audio endpoint.

## Phase gate

Phase 1 passes when all are true:

- [ ] App starts and a production build succeeds.
- [ ] pnpm version and lockfile are pinned; lint/typecheck are separate working scripts.
- [ ] Operator private access, media scope, and webhook rejection are demonstrated.
- [ ] Neo4j seed/read works with no duplicate seed records.
- [ ] Shared contracts and fictional fixtures exist.
- [ ] Bot joins the target meeting, sends a transcript, and emits a sentence heard remotely.
- [ ] Actual provider/model/configuration results are recorded without secrets.
- [ ] `check:core` runs and covers the meaningful setup logic.

If account access is blocked, UI/memory work may continue against explicitly marked fixtures. The live feasibility gate stays incomplete; record the blocker and do not represent this as a fully working meeting bot.

## Submission to Phase 2

Produce `docs/SETUP-RESULTS.md` with installed versions, commands that passed, live-spike result, source paths, unresolved blockers, and assigned workstream owners. Update the top-level handoff to point to this record and the actual next task.

Do not start native sidebar integration, voice cloning, a deployment platform migration, or speculative infrastructure during setup.
