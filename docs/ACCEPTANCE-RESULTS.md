# Acceptance results

Recorded: 2026-09-12. The workspace has no commit yet, so results refer to the current working tree.

| Test | Result | Evidence or remaining check |
| --- | --- | --- |
| Operator privacy | Pass | Logged-out protected-session request returned 401; operator state is scoped by owner. |
| Media authority | Pass locally | One-use bootstrap credentials exchange into a session-scoped media cookie; media routes expose speech commands only. |
| Source setup | Pass | Profile and notes survived reload; meeting use is controlled per source. |
| Join and admission | Blocked | Requires deployed HTTPS callbacks and a real Google Meet. Configuration failure is verified not to reserve a stranded session. |
| Transcript correctness | Pass locally / live blocked | Normalization and delivery deduplication are implemented; local meeting UI rendered committed timed utterances. Real Recall delivery remains to be exercised. |
| Answer from memory | Pass locally | DeepSeek used the seeded Atlas note and returned inspectable evidence. |
| Supporting detail | Pass locally | Support mode returned a grounded draft with evidence in the meeting panel. |
| Clarifying question | Pass locally | Clarify mode distinguished the internal preview from the public launch. |
| Edit then speak | Pass locally / live blocked | The exact approved text reached ElevenLabs and completed the local media command. Another participant must confirm audio in Meet. |
| Repeated approval | Pass by implementation | A database uniqueness constraint scopes each client request ID to one session. |
| Context/version change | Pass | New transcript revisions mark old drafts stale, and speech requires the reviewed revision and suggestion version. |
| Stop while preparing or speaking | Live blocked | Cancellation state is implemented; actual remote interruption needs a Meet test. |
| Media reload/ack loss | Pass | The Neo4j regression run proves commands are claimed atomically and completed commands are not claimable again. |
| End session | Live blocked | Local commands/token revocation and Recall removal are implemented; departure confirmation needs a Meet test. |
| Provider/database failure | Pass by inspection | Routes return explicit unavailable/error responses and do not switch to fixtures. |
| Webhook tampering and ordering | Pass | Tests reject tampering and expired signatures, deduplicate deliveries, and prove an older Recall event cannot move `listening` back to `joining`. |
| Prompt injection | Pass by implementation | User content is passed as quoted evidence, returned evidence IDs are allowlisted, and only server-approved text enters speech. |
| Keyboard and narrow layout | Pass locally | Browser QA covered the operator controls and responsive layout; native controls keep keyboard behavior. |

No live latency target or three-rehearsal gate is claimed. Those measurements begin after the Render URL is available.
