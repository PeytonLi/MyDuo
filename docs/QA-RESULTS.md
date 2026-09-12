# Regression and quality results

Verified: 2026-09-12 against the production Next.js build and the configured local environment, before and after the stretch-feature completion pass. Test records use isolated IDs and are deleted after each run. No credentials or real meeting content are recorded.

## Final result

| Check | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass, zero warnings |
| Unit and trust-boundary tests | 11 passed |
| Neo4j lifecycle integration | 5 passed |
| Production browser tests | 14 passed: seven desktop and seven mobile |
| DeepSeek, ElevenLabs, Recall account checks | 3 passed |
| Production build | Pass |
| Production dependency audit | Pass, no known vulnerabilities |

Run the deterministic suite with `pnpm check:all`. Run the small paid/network provider smoke tests separately with `pnpm test:providers`.

## Stretch-feature regression coverage

Added with the stretch features and included in `pnpm check:all`:

1. **Automatic suggestions.** One transcript revision reserves at most one automatic draft, concurrent reservation attempts collapse to one, dismissal suppresses the same revision plus two, and no `SpeechCommand` is ever created from an automatic draft. The browser suite proves the panel toggle persists operator intent without triggering generation while a manual draft is ready.
2. **Meeting review.** Extraction is idempotent, pending candidates create no memory, accepted text is saved exactly as edited, rejected candidates never reach retrieval, acceptance is scoped to the owning operator, and repeated acceptance is idempotent. A dedicated test proves the cross-meeting gate: an accepted decision from meeting A appears as evidence in the suggestion context of meeting B in the same project. The browser suite drives the full review page flow from an ended session through saving curated memory.
3. **Voice personalization.** Only allowlisted voice IDs pass server validation, previews are rate-limited per operator, a queued command keeps its bound voice after a profile change, and the browser suite covers the three-voice radio picker and viewport fit.
4. **Meet side panel.** Pairing codes are normalized, one-use, session-scoped, and expire; the browser suite loads the panel page and proves a code exchanges exactly once.
5. **Second platform.** Google Meet and Zoom URLs are canonicalized with lookalike hosts rejected, sessions store `meetingPlatform`, and session state exposes it so admission copy differs per platform.

## Regressions found and fixed

1. **Failed configuration could strand an active meeting.** `createMeeting` reserved a Neo4j session before validating `APP_BASE_URL`. Provider configuration now validates before any database mutation, and the integration test proves a missing URL creates zero sessions.
2. **Older Recall status events could move a live bot backward.** Status handling now requires Recall's `updated_at`, stores the provider timestamp/rank, and ignores an older transition. The database test reproduces `listening` followed by an older `joining` event and verifies the state stays `listening`.
3. **Successful logins accumulated toward rate limiting.** A valid login now clears that client's failed-attempt counter. The unit and browser suites cover repeated valid authentication.

The local QA health score moved from 92 to 100 for the exercised scope. The public Google Meet audio and interruption gate remains unscored until Render supplies `APP_BASE_URL`; it still requires a second participant to verify what they hear.
