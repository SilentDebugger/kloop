# kloop

**Self-hosted support that documents itself.**

kloop is an open-source request platform built around one loop: someone asks for help → a supporter fixes it → the fix becomes living documentation → the next person with the same problem never has to ask. Deflection, precedents, AI-drafted articles, automatic merging and staleness detection — with a human approving every published word.

- **Requesters** get a one-box composer with live "this might solve it" suggestions, a status timeline, and a "did this fix it?" confirmation loop.
- **Supporters** get a live queue, a workbench with precedents ("you solved this twice before — same fix?"), 30-second resolution capture (text/voice/photo), and a review inbox where AI-drafted articles, updates, and merge proposals wait for approval.
- **Admins** get deflection/coverage insights, automation tiers (0 = suggestions only … 3 = auto-answer + auto-close), users & roles, email-in, webhooks, and API keys.

Web app (responsive PWA) + native mobile app (Expo, iOS/Android) + REST API, all against one self-hosted server. Bring your own LLM (OpenAI / Anthropic / Ollama / none), your own embeddings (Gemini / OpenAI / Ollama / none), your own Postgres (bundled or Supabase/Neon/RDS), your own storage (disk or S3). A deterministic `mock` provider means **everything runs with zero API keys**.

---

## Install (Docker, ~5 minutes)

Requirements: Docker with the compose plugin.

```bash
git clone <your-fork-or-this-repo> kloop && cd kloop

# interactive wizard: database, storage, AI providers (keys tested live), admin account
npx create-kloop

# — or by hand —
cp .env.example .env      # edit: APP_SECRET, PUBLIC_URL, providers
docker compose up -d
docker compose exec api node dist/cli.js migrate
docker compose exec api node dist/cli.js admin create
```

Open `http://localhost:8787`. One container serves the API, the web app, and the background workers; the bundled Postgres (with pgvector) rides alongside.

**Try it with demo data** — set `SEED_DEMO=true` in `.env` before first boot (or run `docker compose exec api node dist/cli.js seed`) to get the "Fjord Logistics IT" workspace: a live queue, articles, a pending AI draft, a merge proposal, and a documentation gap. Sign in as `maya@fjord.io` (supporter), `jonas.weber@fjord.io` (requester), or `admin@fjord.io` (admin) — password `kloop-demo`.

### Using a managed database (Supabase, Neon, RDS…)

Point `DATABASE_URL` at your Postgres (pgvector must be available — it is on all three) and drop the bundled DB:

```bash
docker compose -f docker-compose.yml -f compose.external-db.yml up -d
```

### S3-compatible storage

Set `STORAGE_DRIVER=s3` and the `STORAGE_S3_*` variables (AWS S3, MinIO, Supabase Storage). A MinIO container is included behind a profile: `docker compose --profile minio up -d`.

### Health check

```bash
docker compose exec api node dist/cli.js doctor
# ✓ database · ✓ pgvector · ✓ migrations · ✓ embeddings · ✓ llm · ✓ storage · ✓ smtp
```

---

## The knowledge loop

```
request ──► deflection ──► self-solved (no ticket)
   │
   ▼
queue ──► workbench (precedents, AI draft) ──► resolution capture (<30s, rough is fine)
                                                     │
                                                     ▼
                                    clustering ──► article generation (LLM drafts, block-based)
                                                     │
                                                     ▼
                                     review inbox ── human approves ──► published article
                                                     │
                          merge scan · contradiction detection · freshness scoring
                          (proposals also land in the review inbox — never auto-applied)
```

Search everywhere is **hybrid**: pgvector cosine similarity fused with Postgres full-text via Reciprocal Rank Fusion — paraphrases *and* exact error codes both hit.

## Configuration

Every knob is an environment variable, documented inline in [`.env.example`](.env.example). The important ones:

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | bundled container | any Postgres 14+ with pgvector |
| `LLM_PROVIDER` | `mock` | `openai`, `anthropic`, `ollama`, `mock` |
| `EMBEDDING_PROVIDER` | `mock` | `gemini` (multimodal — embeds photos/voice directly), `openai`, `ollama`, `mock` |
| `EMBEDDING_DIMENSIONS` | `1536` | vector size, fixed at first migration |
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `AUTOMATION_TIER` | `0` | default tier for new orgs; per-org + per-tag in admin UI |
| `SMTP_*` | — | magic links + email notifications |

## Development

Requirements: Node 22+, pnpm 10, Docker.

```bash
pnpm install
docker compose -f compose.dev.yml up -d   # Postgres :5433 + Mailpit :8025
pnpm db:migrate && pnpm seed
pnpm dev                                   # API :8787 + web (Vite) :5173
```

Magic-link emails land in Mailpit at `http://localhost:8025`. The API smoke test drives the whole loop end-to-end:

```bash
node scripts/smoke.mjs http://localhost:8787 admin@fjord.io kloop-demo
pnpm test        # engine unit tests (RRF fusion, merge scoring, tier logic, …)
pnpm typecheck
```

### Dev URLs & demo accounts

| What | Where |
| --- | --- |
| Web app (Vite) | http://localhost:5173 |
| API | http://localhost:8787 |
| Mailpit (magic links & notification emails) | http://localhost:8025 |
| Postgres | `localhost:5433` · user/pass/db `kloop`/`kloop`/`kloop` |
| Expo Metro | http://localhost:8081 |

Demo accounts (from `pnpm seed`, org **Fjord Logistics IT**) — password is `kloop-demo` for all:

| Email | Role |
| --- | --- |
| `admin@fjord.io` | admin |
| `maya@fjord.io` | supporter |
| `jonas.weber@fjord.io` | requester |

### Mobile app

```bash
pnpm dev:mobile   # Expo dev server — scan with Expo Go or run a dev build
```

In the app, connect to your server by domain (or scan the QR code from **Admin → Integrations**), sign in, done. Multiple workspaces (orgs/servers) are supported with per-org branding from the discovery document at `/.well-known/kloop.json`.

Connecting to your **local dev server** from the connect screen:

- iOS simulator / Android emulator on the same machine: enter `localhost:8787`
- Physical device via Expo Go: enter `<your-machine-LAN-IP>:8787` (e.g. `192.168.0.34:8787`) — the device must be on the same network
- Plain `http://` is fine — the connect screen automatically falls back to it for local servers

Then sign in with one of the demo accounts above (requesters get the requester tabs, supporters/admins get the supporter tabs).

## Repo layout

```
apps/server      Hono + Node 22 API, pg-boss workers, knowledge engine, kloop CLI
apps/web         React 19 + Vite responsive SPA / PWA
apps/mobile      Expo + React Native (requester + supporter, multi-org)
packages/shared  zod schemas, API types, typed client, design tokens (web + mobile)
packages/create-kloop   the setup wizard
design/          the mockups this UI implements
documentation.md · feature-overview.md   product docs
```

## API & integrations

- **REST API** with API-key auth (`Admin → Integrations`): create requests, search, manage articles — everything the UIs use.
- **Email-in**: an inbound-email webhook endpoint compatible with SendGrid/Mailgun/SES-parse payloads turns emails into requests.
- **Outbound webhooks** on request/article events, HMAC-signed.
- **SSE** streams for queue, threads, and review badges.
- **Discovery document** at `/.well-known/kloop.json` — lets any client (including the mobile app) autoconfigure against your server.
- **Markdown export** per article (`GET /api/articles/:id/markdown`) — your knowledge is never locked in.

## License

License to be finalized (AGPL-3.0 vs Apache-2.0 — see `LICENSE-TBD`). Until then, all rights reserved by the repository owner.
