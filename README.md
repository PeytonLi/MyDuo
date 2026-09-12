# MyDuo

MyDuo is a private meeting copilot. It listens through a visible Recall.ai participant, combines the current conversation with confirmed Neo4j memory, drafts a contribution privately, and speaks only text the operator approves through ElevenLabs.

## Run locally

Requirements: Node.js 24 and pnpm 10.30.3.

```bash
pnpm install
copy .env.example .env.local
pnpm setup:local
pnpm seed
pnpm dev
```

Fill the provider values in `.env.local` before seeding or starting a live meeting. `APP_BASE_URL` must be a public HTTPS origin for Recall webhooks and Output Media; a localhost URL is sufficient for UI and fixture work only.

Open `http://localhost:3000`, sign in with the generated `DEMO_ACCESS_SECRET`, load the fictional Project Atlas seed, and start a meeting from a Google Meet URL.

## Checks

```bash
pnpm check:all
```

This runs type checking, linting, unit regression checks, an isolated Neo4j lifecycle, a production build, and desktop/mobile browser tests. `pnpm test:providers` separately verifies the configured DeepSeek model, ElevenLabs voice, and Recall account because those checks use live provider APIs.

The implementation plan, product requirements, integration contracts, [setup results](docs/SETUP-RESULTS.md), [QA results](docs/QA-RESULTS.md), and [acceptance results](docs/ACCEPTANCE-RESULTS.md) are in `docs/`.

## Deploy to Render

The included `render.yaml` creates one Node web service. Add the secret values from `.env.local` in Render, set `APP_BASE_URL` to the service's HTTPS origin, deploy, and confirm `/api/health` returns `{ "ok": true }` before connecting Recall.
