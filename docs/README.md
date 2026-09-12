# MyDuo planning documents

Status: tested MVP implemented; stretch work planned.
Updated: 2026-09-12 (America/Los_Angeles).

MyDuo is a personal meeting copilot that uses your context to suggest answers, recover supporting details, and formulate clarifying questions. Suggestions appear privately; the meeting bot speaks only text you approve.

## Read in this order

1. [Product requirements](PRD.md): problem, product, scope, experience, requirements, and success criteria.
2. [Architecture and contracts](ARCHITECTURE.md): selected stack, data model, integration boundaries, and delivery behavior.
3. [Phase 1: setup](phases/01-SETUP.md): foundation, credentials, contracts, and live audio feasibility gate.
4. [Phase 2: features](phases/02-FEATURES.md): independent workstreams, ownership, subtasks, and integration submissions.
5. [Phase 3: integration and testing](phases/03-INTEGRATION-TESTING.md): assembled flow, failure tests, acceptance evidence, and demo preparation.
6. [Handoff](HANDOFF.md): concise starting context for the next implementation session.
7. [Stretch-feature plan](STRETCH-PLAN.md): deployment gate, proactive suggestions, reviewed memory, voice choice, Meet add-on, and second-platform sequence.

## Planning assumptions

- “PRT” in the request is interpreted as PRD, consistent with the rest of the request.
- Next.js and pnpm are user requirements. Neo4j and ElevenLabs are selected to fulfill the original concept.
- The baseline is a separate private companion web panel and one Google Meet meeting, with a visible bot. A native Meet/Zoom sidebar is a later option.
- “Parallel with submissions” is covered as bounded implementation workstreams with reviewable submissions. Hackathon submission preparation is also included in Phase 3; actual event rules remain unknown.
- A 24–48-hour hackathon is a planning assumption, not a promised estimate. Team size, deadline, sponsor requirements, and API credits are not yet known.
- The initial MVP is implemented and tested. The stretch plan records the next implementation sequence and its gates.

## Document ownership

The PRD owns product behavior and acceptance criteria. Architecture owns technical contracts. Phase documents own execution order and evidence. Handoff references those artifacts instead of repeating them.

Implementation agents should update the relevant document when a validated integration constraint changes the plan. Do not silently claim a fallback demo fulfills a live-meeting requirement.
