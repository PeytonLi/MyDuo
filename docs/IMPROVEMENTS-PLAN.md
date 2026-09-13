# MyDuo reliability and clarity plan

The live two-person rehearsal gate is complete. The remaining work is organized around the operator's control of speech, clear draft provenance, recoverable meetings, and lightweight personalization.

## Phase 1: Speech control

- Cancel queued, synthesizing, and playing speech immediately when Stop is requested.
- Prevent completed ElevenLabs audio from starting after a newer Stop revision.
- Make media acknowledgements retry-safe and clear abandoned speech commands.
- Cover Stop during preparation and acknowledgement loss with deterministic regressions.

## Phase 2: Draft clarity and reuse

- Persist the transcript lines that triggered each draft.
- Show those lines under **Responding to…** in the companion and Meet panels.
- Let the operator explicitly mark a stale draft as still relevant against the latest transcript revision.
- Preserve generated and approved wording and supply up to three recent edits as style-only examples for future drafts.

## Phase 3: Meeting recovery and history

- List an active or uncertain meeting on the home page.
- Provide Resume and End controls for a meeting that did not return cleanly from Recall.
- List recently ended meetings that are ready for memory review.
- Cover discovery, recovery, and review navigation in database and browser tests.

## Final integration

- Run type checking, linting, unit tests, Neo4j integration tests, the production build, and browser regressions.
- Re-run the deployed meeting path after release, with special attention to Stop during synthesis and the uncertain-session recovery controls.
