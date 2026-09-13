# MyDuo

The private copilot for your meetings.

MyDuo joins a Google Meet call as a visible participant. Nothing is recorded in secret, and it does not pretend to be human. It listens, keeps live notes, and drafts contributions grounded in your team's confirmed memory. It never says a word to the room until you approve the exact words, and it waits for a quiet moment so it does not talk over people.

## What MyDuo does

- Joins the call as a visible participant. You admit it like any teammate, everyone on the call can see it, and you can end it at any time.
- Remembers in a graph, not a transcript dump. Confirmed facts live in a Neo4j knowledge graph with owners, deadlines, dependencies, and source documents, and MyDuo traverses that graph when a question comes up.
- Drafts privately, with receipts. Drafts appear only in your private panel or your Google Meet side panel, and each one shows its evidence: which graph tools the model called, which facts and sources support every claim, the reasoning path, latency, and token counts. The model cannot write its own database queries; it picks from four fixed, validated tools.
- Speaks only what you approved. You edit the draft, then press Speak. The exact words go to the room in an ElevenLabs voice, but only once no one else is talking. Stop cancels mid-sentence.
- Grows memory after human review. Quick notes and meeting decisions become pending candidates with transcript evidence, and a person accepts or rejects each one. Contradictions surface explicitly: replacing an outdated deadline closes the old fact and links it to the new one, so you keep the full history of what changed.
- Shows measured behavior. A dashboard reports the grounded-draft share, graph hops per draft, approval rate, and latencies, recorded from the traces of real drafts.

Built solo, end to end.

## Two-minute demo

**Demo video: <https://youtu.be/Vq5zroJmaJk>**

[docs/DEMO-GUIDE.md](docs/DEMO-GUIDE.md) has the full live script: what to say, what your teammate says, and recovery lines for when things go off-script.

A live deployment is running at <https://myduo-daqq.onrender.com> (access-protected).

## External apps used

| App | What it does for MyDuo |
| --- | --- |
| [Recall.ai](https://recall.ai) | The visible meeting participant: joins the call, streams live transcription, and plays approved audio into the meeting. |
| [Google Meet](https://meet.google.com) | The meeting platform, plus a Workspace Marketplace add-on that runs MyDuo's private side panel inside the call. |
| [DeepSeek](https://www.deepseek.com) | Drafts contributions using function calling over four fixed graph tools; never authors database queries. |
| [Neo4j AuraDB](https://neo4j.com/product/auradb/) | The knowledge graph: projects, facts, owners, deadlines, dependencies, sources, and supersession history. |
| [ElevenLabs](https://elevenlabs.io) | Streams the approved words as a natural voice. |
| [Render](https://render.com) | Hosts the deployed application. |

## Run locally

Requirements: Node.js 24 and pnpm 10.30.3.

```bash
pnpm install
copy .env.example .env.local
pnpm setup:local
pnpm seed
pnpm dev
```

Fill the provider values in `.env.local` before seeding or starting a live meeting. `APP_BASE_URL` must be a public HTTPS origin for Recall webhooks and Output Media; a localhost URL only works for UI and fixture work.

Open `http://localhost:3000`, sign in with the generated `DEMO_ACCESS_SECRET`, load the fictional Northstar seed, and start a meeting from a Google Meet URL.

## How reliability was tested

Every change runs through `pnpm check:all` before it is deployed:

- 16 end-to-end browser tests (Playwright, desktop and mobile viewports) covering login, drafting, edit and stale protection, quick notes, review with conflict resolution, Meet add-on pairing, and viewport fit.
- 7 integration tests against an isolated Neo4j lifecycle: memory and webhook handling, media authority, speech state machine, auto-suggest suppression, review parsing, supersession, and quick notes.
- 17 unit tests for parsing, validation, and security boundaries (webhook signatures, origin and bearer checks).
- A 20-scenario behavioral evaluation (`pnpm test:evaluation`) that replays meeting situations against the auto-suggest trigger rules, including the five situations that must not trigger.
- Live provider checks (`pnpm test:providers`) verifying the configured DeepSeek model, ElevenLabs voice streaming, and Recall account.

Beyond the suites, I verified reliability in live two-participant Google Meet rehearsals: join, admission, transcription, drafting, speaking, Stop, and departure. The results are in [docs/ACCEPTANCE-RESULTS.md](docs/ACCEPTANCE-RESULTS.md). Recovery paths are exercised in production too: a session interrupted mid-meeting can be resumed or ended from the home page, and the bot can wait in the meeting's waiting room without losing its audio link.

## Documentation

The [product requirements](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), [technical excellence plan](docs/TECHNICAL-EXCELLENCE-PLAN.md), [demo guide](docs/DEMO-GUIDE.md), [setup results](docs/SETUP-RESULTS.md), [QA results](docs/QA-RESULTS.md), and [acceptance results](docs/ACCEPTANCE-RESULTS.md) are in `docs/`.

## Deploy to Render

The included `render.yaml` creates one Node web service. Add the secret values from `.env.local` in Render, set `APP_BASE_URL` to the service's HTTPS origin, deploy, and confirm `/api/health` returns `{ "ok": true }` before connecting Recall.
