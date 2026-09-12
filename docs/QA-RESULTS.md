# Regression and quality results

Verified: 2026-09-12 against the production Next.js build and the configured local environment. Test records use isolated IDs and are deleted after each run. No credentials or real meeting content are recorded.

## Final result

| Check | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass, zero warnings |
| Unit and trust-boundary tests | 9 passed |
| Neo4j lifecycle integration | 1 passed |
| Production browser tests | 8 passed: four desktop and four mobile |
| DeepSeek, ElevenLabs, Recall account checks | 3 passed |
| Production build | Pass |
| Production dependency audit | Pass, no known vulnerabilities |

Run the deterministic suite with `pnpm check:all`. Run the small paid/network provider smoke tests separately with `pnpm test:providers`.

## Regressions found and fixed

1. **Failed configuration could strand an active meeting.** `createMeeting` reserved a Neo4j session before validating `APP_BASE_URL`. Provider configuration now validates before any database mutation, and the integration test proves a missing URL creates zero sessions.
2. **Older Recall status events could move a live bot backward.** Status handling now requires Recall's `updated_at`, stores the provider timestamp/rank, and ignores an older transition. The database test reproduces `listening` followed by an older `joining` event and verifies the state stays `listening`.
3. **Successful logins accumulated toward rate limiting.** A valid login now clears that client's failed-attempt counter. The unit and browser suites cover repeated valid authentication.

The local QA health score moved from 92 to 100 for the exercised scope. The public Google Meet audio and interruption gate remains unscored until Render supplies `APP_BASE_URL`; it still requires a second participant to verify what they hear.
