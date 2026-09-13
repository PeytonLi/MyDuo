# Acceptance results

Recorded: 2026-09-12. The workspace has no commit yet, so results refer to the current working tree.

| Test | Result | Evidence or remaining check |
| --- | --- | --- |
| Operator privacy | Pass | Logged-out protected-session request returned 401; operator state is scoped by owner. |
| Media authority | Pass locally | One-use bootstrap credentials exchange into a session-scoped media cookie; media routes expose speech commands only. |
| Source setup | Pass | Profile and notes survived reload; meeting use is controlled per source. |
| Join and admission | Pass, operator verified | The deployed bot joined the user's rehearsal calls successfully. Automated failure and recovery paths remain covered separately. |
| Transcript correctness | Pass | Normalization and delivery deduplication are implemented, and the operator reports successful live rehearsal transcription. |
| Answer from memory | Pass locally | DeepSeek used the seeded Atlas note and returned inspectable evidence. |
| Supporting detail | Pass locally | Support mode returned a grounded draft with evidence in the meeting panel. |
| Clarifying question | Pass locally | Clarify mode distinguished the internal preview from the public launch. |
| Edit then speak | Pass | The exact approved text is covered locally, and the operator reports successful audible speech in live rehearsals. |
| Repeated approval | Pass by implementation | A database uniqueness constraint scopes each client request ID to one session. |
| Context/version change | Pass | New transcript revisions mark old drafts stale, and speech requires the reviewed revision and suggestion version. |
| Stop while preparing or speaking | Pass live; strengthened locally | The operator reports successful rehearsal interruption. Regression coverage now prevents synthesis completed after Stop from becoming playable. |
| Media reload/ack loss | Pass | The Neo4j regression run proves commands are claimed atomically and completed commands are not claimable again. |
| End session | Pass, operator verified | Local commands and tokens are revoked, Recall removal is requested, and the operator reports successful departure in rehearsal calls. |
| Provider/database failure | Pass by inspection | Routes return explicit unavailable/error responses and do not switch to fixtures. |
| Webhook tampering and ordering | Pass | Tests reject tampering and expired signatures, deduplicate deliveries, and prove an older Recall event cannot move `listening` back to `joining`. |
| Prompt injection | Pass by implementation | User content is passed as quoted evidence, returned evidence IDs are allowlisted, and only server-approved text enters speech. |
| Keyboard and narrow layout | Pass locally | Browser QA covered the operator controls and responsive layout; native controls keep keyboard behavior. |

The operator reports that the deployed rehearsals passed. Exact latency measurements were not recorded in this document.
