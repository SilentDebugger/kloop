# Knowledge Loop *(working title: `kloop`)*

> An open-source, self-hosted request platform that turns every solved problem into living documentation.

Users ask for help. Supporters resolve and capture what they did in seconds. The system distills resolutions into a knowledge base that answers the next request automatically — and keeps learning passively while people simply use it.

**This is not another issue board.** There are no sprints, swimlanes, story points, or status theater. The documentation is the product; tickets are just the raw material that feeds it.

---

## Table of Contents

1. [Core Idea: The Knowledge Loop](#1-core-idea-the-knowledge-loop)
2. [Who It's For](#2-whos-it-for)
3. [Feature Overview](#3-feature-overview)
4. [Platform & Architecture](#4-platform--architecture)
5. [Database & Deployment Options](#5-database--deployment-options)
6. [Vectorization Strategy](#6-vectorization-strategy)
7. [Article Lifecycle: Generation, Evolution & Merging](#7-article-lifecycle-generation-evolution--merging)
8. [Data Model Sketch](#8-data-model-sketch)
9. [Automation Tiers](#9-automation-tiers)
10. [Installation & Setup](#10-installation--setup)
11. [Non-Negotiable Design Principles](#11-non-negotiable-design-principles)
12. [Roadmap](#12-roadmap)

---

## 1. Core Idea: The Knowledge Loop

```
   ┌──────────────────────────────────────────────────────┐
   │                                                      │
   ▼                                                      │
REQUEST ──► MATCH ──► RESOLVE ──► CAPTURE ──► DISTILL ──► DOCS
   │           │                                           ▲
   │           └── "already documented?" ──► self-solve ───┘
   │                                          (deflection)
   └── every request makes the next one cheaper
```

1. **Request** — a user asks for help (web, mobile, email — anything).
2. **Match** — before and during creation, the system searches existing knowledge. If a doc answers it, the request never becomes work.
3. **Resolve** — a supporter fixes the problem.
4. **Capture** — the supporter dumps *what they did* in <30 seconds: a sentence, a voice memo, a photo, a pasted command. The system does the structuring, not the human.
5. **Distill** — resolutions are clustered, and the system drafts/updates knowledge articles from them (human-reviewed).
6. **Deflect & Automate** — the next similar request gets answered by the docs, a drafted reply, or a fully automated response, depending on confidence and org trust settings.

The system is **domain-agnostic**: "issues" can be code bugs, broken printers, HR questions, the coffee machine on floor 3, or anything else. No IT-specific assumptions are hardcoded.

---

## 2. Who It's For

Two first-class personas, each with their own dashboard on **web and mobile**:

| | Requester | Supporter |
|---|---|---|
| Goal | Get unblocked fast | Resolve fast, document effortlessly |
| Sees | One text box, suggested answers, minimal status (open / handled / solved) | Queue with AI-matched precedents, capture tools, doc review inbox |
| Never sees | Assignees, priorities, internal notes | Nothing hidden — full context |

A third, thinner persona: **Manager/Insights** — deflection rate, knowledge coverage map, recurring-issue heatmaps, time-saved estimates.

---

## 3. Feature Overview

### Requester side
- One-box request creation with optional photo / screenshot / voice note
- **Deflection-first flow**: live doc suggestions while typing, with one-tap "this solved it" (counted as an automated resolution — a core metric)
- Minimal status model; "Did this fix it?" confirmation loop (user confirmation = *trusted resolution* signal for learning)
- Channel-agnostic intake: web, mobile, email-in; later Slack/Teams webhooks

### Supporter side
- Queue with **AI-suggested precedents**: "3 similar past requests, here's what worked" — shown before the ticket is even opened
- **Frictionless capture**: free text, voice memo (transcribed), photo, pasted commands/logs — structured automatically
- One-tap **"same as last time"** resolution linking (strong recurrence signal)
- **Draft-review inbox**: AI-generated and AI-updated articles land here for a 30-second approve / edit / reject. Never auto-published by default.

### Knowledge engine
- Automatic clustering of similar requests ("printer offline" reported 14 ways = 1 problem)
- Article generation from resolution clusters (template: title, symptoms, problem, resolution steps, related articles, provenance)
- **Article evolution**: new deviating resolutions propose an *update* or a *fork* — never silent duplicates (see [§7](#7-article-lifecycle-generation-evolution--merging))
- Confidence & freshness scoring; stale-doc flagging
- Gap detection: recurring undocumented issues surfaced, ranked by frequency × time cost

### Manager layer
- Deflection rate (north-star metric), coverage map, heatmaps, root-cause surfacing

---

## 4. Platform & Architecture

### High-level

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENTS                                                    │
│  ┌────────────┐ ┌────────────┐ ┌─────────────────────────┐ │
│  │ Web App    │ │ Mobile App │ │ Email-in / Webhooks /   │ │
│  │ (both      │ │ (both      │ │ Slack / Teams / API     │ │
│  │  roles)    │ │  roles)    │ │                         │ │
│  └─────┬──────┘ └─────┬──────┘ └───────────┬─────────────┘ │
└────────┼──────────────┼────────────────────┼───────────────┘
         │        HTTPS + WebSocket          │
         ▼              ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│  ONE SELF-HOSTED BACKEND (single container / binary)        │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────────────────┐│
│  │ REST/    │ │ Auth (OIDC/  │ │ Background workers:      ││
│  │ GraphQL  │ │ email magic  │ │ embedding, clustering,   ││
│  │ API      │ │ link, SSO)   │ │ article gen, merge scan  ││
│  └──────────┘ └──────────────┘ └──────────────────────────┘│
│  ┌──────────────────────────────────────────────────────┐  │
│  │ LLM/Embedding provider abstraction                   │  │
│  │ (OpenAI / Anthropic / local via Ollama — BYO-LLM)    │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
              ┌─────────────────────────┐
              │ PostgreSQL + pgvector   │
              │ (self-hosted OR         │
              │  Supabase/Neon/RDS/...) │
              └─────────────────────────┘
              ┌─────────────────────────┐
              │ Object storage (S3-     │
              │ compatible / MinIO)     │
              │ for photos, audio       │
              └─────────────────────────┘
```

### Clients

- **Web app** — single SPA/SSR app serving both roles; role determined by login. Responsive, installable as PWA.
- **Mobile app** — one app, both roles. Recommended stack: **React Native + Expo**, sharing UI components, API client, and types with the web app in a monorepo (e.g. Turborepo). One codebase, three targets (iOS, Android, web).
- **Server connection flow (company-specific apps)**:
  1. User opens the app → "Connect to your organization"
  2. Enters a domain (`help.acme.com`) **or scans a QR code** from their org's web dashboard
  3. App fetches `https://<domain>/.well-known/kloop.json` → discovery document with API base URL, auth methods, org name, logo, theme colors
  4. App stores the connection; **multiple orgs can be added and switched** (like Slack/Mattermost workspaces)
  
  This keeps the app generic in the app stores while feeling company-specific after connect (logo, colors, name from the discovery document).

### Backend

- One deployable unit: **single Docker container** (or binary) containing API + background workers. Optional worker scale-out later, but `docker compose up` must be a complete production-capable install.
- Suggested stack: **TypeScript (NestJS/Hono) or Go** for the API; job queue on Postgres (e.g. pg-boss / River) — *no Redis requirement* for the default install. Fewer moving parts = more OSS adoption.
- Realtime via WebSocket/SSE for queue updates and "someone is typing/handling this".
- Everything the UI can do is available via **REST API + webhooks** (integration-first).

---

## 5. Database & Deployment Options

**One hard dependency: PostgreSQL (≥15) with the `pgvector` extension.** That single choice elegantly covers every deployment preference:

| Mode | How |
|---|---|
| Fully self-hosted | `docker compose up` — bundles Postgres+pgvector, MinIO, and the backend |
| Managed DB (Supabase) | Point `DATABASE_URL` at your Supabase project — Supabase ships pgvector out of the box; optionally reuse Supabase Auth & Storage via adapters |
| Managed DB (other) | Neon, RDS, Cloud SQL, Azure — anything Postgres with pgvector |

Why **not** a separate vector database (Pinecone/Qdrant/Weaviate) by default:
- One database = one backup, one migration story, one thing to secure
- **Vectors live next to relational data**, so a single SQL query can combine semantic similarity with filters (`org_id`, tags, status, freshness) and joins — exactly what our matching needs
- pgvector with HNSW indexes comfortably handles the scale of even large helpdesks (millions of rows)
- A `VectorStore` interface still abstracts this, so a dedicated vector DB can be added later for extreme scale

Storage abstraction likewise: local disk → MinIO → S3 → Supabase Storage behind one interface.

Configuration is entirely env-driven (12-factor): `DATABASE_URL`, `STORAGE_*`, `LLM_PROVIDER`, `EMBEDDING_PROVIDER`, `AUTOMATION_TIER`, etc.

---

## 6. Vectorization Strategy

**Principle: everything textual gets embedded, at the right granularity, into one unified vector space per org.** This is what powers matching, clustering, dedup, gap detection, and merging — it's the connective tissue of the whole product.

### What gets embedded

| Entity | Granularity | Used for |
|---|---|---|
| Request | title + body (one vector) | live deflection, precedent matching, clustering |
| Resolution capture | full capture (one vector) | "same as last time" suggestions, article sourcing |
| Article | **per-chunk** (symptoms, each step-group, notes) + one summary vector | retrieval, merge detection, contradiction detection |
| Conversation messages | per message (supporter replies only) | mining undocumented answers |
| Attachments | OCR/transcript text → embedded | photos of error screens, voice memos |
| Tags/entities | label + description | auto-tagging, taxonomy emergence |

### How

- **Embedding provider abstraction**: OpenAI, Anthropic-compatible, or local models via Ollama (e.g. `nomic-embed-text`). Model name + dimension stored per org; a model change triggers a background re-embedding migration (versioned `embedding_model` column — old and new can coexist during migration).
- **Hybrid search always**: vector similarity (cosine, HNSW index) **combined with** Postgres full-text search (BM25-style), fused via Reciprocal Rank Fusion. Pure vector search misses exact identifiers ("error 0x80070005", "printer HP-4-West"); pure keyword search misses paraphrases. Hybrid is non-negotiable.
- **Metadata-filtered similarity**: every vector query is scoped by `org_id` (hard tenant isolation) and can filter by tags, entity, freshness, status — one SQL query, thanks to pgvector living inside Postgres.
- **Async pipeline**: writes never block on embedding. A worker picks up new/changed rows (`embedding_status = pending`), embeds in batches, updates the index. Target: <5s from creation to searchable.

### Where vectors are used in the product

1. **Deflection**: as the requester types (debounced), embed the draft → top-k article chunks + resolved requests → show suggestions
2. **Supporter precedents**: on ticket open → nearest resolved requests with their resolutions
3. **Clustering**: periodic incremental clustering (HDBSCAN or threshold-based agglomerative) over request vectors → problem clusters
4. **Gap detection**: clusters with high mass but no linked article above a similarity threshold
5. **Merge & contradiction detection**: article↔article and resolution↔article-chunk similarity (see next section)

---

## 7. Article Lifecycle: Generation, Evolution & Merging

This is the heart of the tool, so here's the full technical treatment.

### 7.1 Articles are structured, not blobs

An article is **a tree of typed blocks**, stored as rows (not one markdown string):

```
Article
├── meta: title, summary, tags, entities, confidence, freshness
├── SymptomsBlock        ("what the user sees")
├── EnvironmentBlock     (optional: applies-to conditions, e.g. "Windows 11", "Building B")
├── ResolutionBlock #1   (ordered steps)
├── ResolutionBlock #2   (alternative path, with condition)
├── NotesBlock
└── Provenance           (links to every source request/resolution + timestamps)
```

Why blocks matter: **merging becomes a block-level operation instead of a scary document-level rewrite.** Two articles rarely conflict entirely — usually their symptoms overlap while resolutions differ by environment. Blocks let us merge the overlap and *condition* the differences. Markdown export flattens the tree, so the "docs are plain markdown, git-syncable" promise still holds.

Every article is **versioned** (immutable revisions), and every block carries **provenance** — which resolutions/requests it was distilled from. Provenance is what makes merges auditable and reversible.

### 7.2 Merge candidate detection (continuous, cheap)

A background job maintains an **article similarity graph**:

1. For every article pair within an org (pruned via ANN — only pairs whose *summary vectors* have cosine similarity ≥ 0.75 are considered at all)
2. Compute a **composite merge score**:
   - `sim_symptoms` — max/mean similarity between their symptom chunks
   - `sim_resolution` — similarity between resolution chunks
   - `cluster_overlap` — Jaccard overlap of the request clusters that feed them
   - `co_retrieval` — how often both articles appear in the same top-k search results (logged from real usage — the strongest practical duplicate signal)
   - `entity_overlap` — shared tagged entities
3. Score above threshold → create a **MergeCandidate** record

The four canonical outcomes, decided by the *shape* of the similarity:

| Symptoms | Resolutions | Verdict |
|---|---|---|
| high | high | **Duplicate → merge** into one article |
| high | low | **Same problem, different fixes → merge with conditioned resolution branches** ("If X, do A; if Y, do B") — often the environment (OS, location, model) is the condition |
| low | high | **Different problems, same fix → keep separate**, cross-link ("see also"), optionally extract the shared fix into a referenced snippet |
| partial | partial | **Fork or restructure** — LLM proposes a parent "overview" article with two scoped children |

### 7.3 The merge pipeline (LLM proposes, human disposes)

```
MergeCandidate
   │
   ▼
LLM merge proposal ──► produces:
   • merged block tree (draft)
   • a human-readable DIFF (what was kept / combined / conditioned / dropped)
   • confidence + rationale ("both describe VPN timeout; article B adds the
     macOS-specific step; symptoms merged, resolutions branched on OS")
   │
   ▼
Supporter review inbox ──► side-by-side 3-pane view:
   Article A | Article B | Proposed merge (with per-block accept/edit/reject)
   │
   ├─ approve ──► new revision published
   │              • losing article → tombstone with 301-style redirect
   │                (old links & vectors point to the survivor)
   │              • provenance = union of both articles' provenance
   │              • embeddings of merged blocks recomputed
   ├─ edit-then-approve
   └─ reject ──► pair recorded as "not-a-duplicate" (negative constraint:
                  suppresses re-proposal unless similarity rises significantly;
                  also usable as few-shot signal for future proposals)
```

Key safeguards:

- **Merges are never automatic.** Ever. Even at the highest automation tier, merging changes canonical knowledge and always passes human review. (Auto-*answering* can be automated; auto-*rewriting the source of truth* cannot.)
- **Tombstones, not deletions.** The losing article ID redirects forever — inbound links, bookmarks, and old ticket references never break.
- **Full reversibility.** Because revisions are immutable and provenance is preserved, a bad merge can be split again with one action.
- **Contradiction detection is the same machinery pointed at time**: when a *new resolution* is highly similar to an article's symptoms but its steps disagree with the article's resolution blocks, the system proposes an **update** (new revision) or a **conditioned branch** — this is how docs stay fresh instead of rotting.

### 7.4 Why not "just let the LLM merge everything nightly"?

Because trust is the product. A knowledge base that silently rewrites itself gets ignored by supporters within a month. The design bet: **cheap continuous vector math finds candidates; the LLM does the expensive reasoning only on candidates; a human spends 30 seconds on a diff.** That keeps LLM costs low, quality high, and supporters in control.

---

## 8. Data Model Sketch

```
orgs(id, name, domain, theme, settings)
users(id, org_id, role: requester|supporter|admin, ...)

requests(id, org_id, author_id, title, body, status: open|handled|solved,
         channel, created_at, embedding vector, embedding_model,
         cluster_id → clusters)

resolutions(id, request_id, supporter_id, raw_capture_text, capture_kind:
            text|voice|photo|command|mixed, structured_summary, trusted: bool,
            linked_resolution_id,  -- "same as last time"
            embedding vector)

clusters(id, org_id, centroid vector, label, request_count, article_id?)

articles(id, org_id, current_revision_id, status: draft|published|tombstone,
         redirect_to_article_id?, confidence, freshness_score)

article_revisions(id, article_id, created_by: ai|user_id, parent_revision_id,
                  approved_by, created_at)

article_blocks(id, revision_id, kind: symptoms|environment|resolution|notes,
               position, condition_json?, content_md,
               embedding vector)

provenance(article_block_id, source_kind: request|resolution, source_id)

merge_candidates(id, article_a, article_b, scores_json,
                 status: proposed|approved|rejected|suppressed,
                 proposal_revision_id?, reviewed_by, verdict:
                 merge|branch|crosslink|fork)

attachments(id, owner_kind, owner_id, storage_key, ocr_or_transcript_text,
            embedding vector)

events(...)  -- append-only audit log; also the learning signal store
             -- (doc shown → helpful?, auto-answer sent → confirmed?)
```

---

## 9. Automation Tiers

Orgs slide automation up as trust builds — per tag/cluster, not only globally:

| Tier | Behavior |
|---|---|
| 0 | Suggestions only (docs shown to requester & supporter) |
| 1 | AI drafts replies; supporter sends |
| 2 | Auto-answer for high-confidence recurring issues; auto-escalate if user says "didn't help" |
| 3 | Auto-answer + auto-close on user confirmation |

Article **generation** proposals: always on. Article **publication & merging**: always human-approved (configurable trusted-author fast-path later, but that's the last thing to loosen).

---

## 10. Installation & Setup

**Everything is Docker-based.** The server, workers, database, and object storage all ship as containers; a fresh machine with Docker installed is the only prerequisite. There are two supported paths to a running instance — both end in the same place.

### Path A — Guided setup (recommended)

An interactive terminal wizard for people who just want it running:

```bash
# one-liner, no clone required
curl -fsSL https://get.kloop.dev | sh
# — or, if you prefer inspecting first —
npx create-kloop@latest
```

The wizard walks through every decision interactively (TUI with sensible defaults on every step):

```
┌ kloop setup ────────────────────────────────────────────────┐
│                                                             │
│  1. Instance                                                │
│     › Organization name        [Acme Corp]                  │
│     › Public URL               [https://help.acme.com]      │
│                                                             │
│  2. Database                                                │
│     › ● Bundled Postgres (runs as a container, zero config) │
│       ○ Existing Postgres / Supabase (paste DATABASE_URL,   │
│         connection + pgvector availability are verified     │
│         live before continuing)                             │
│                                                             │
│  3. Storage                                                 │
│     › ● Bundled MinIO   ○ S3-compatible   ○ Supabase        │
│                                                             │
│  4. AI Provider                                             │
│     › ○ OpenAI   ○ Anthropic   ● Local (Ollama)   ○ Skip    │
│       (API key / endpoint tested with a real call)          │
│                                                             │
│  5. Admin account + TLS (Let's Encrypt via bundled proxy,   │
│     or "I have my own reverse proxy")                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

What the wizard actually does under the hood — no magic:

1. Generates a `docker-compose.yml` **and a fully commented `.env`** from your answers (secrets auto-generated)
2. Pulls images, starts the stack, runs DB migrations, enables `pgvector`
3. Creates the admin account and the org's discovery document (`/.well-known/kloop.json`) so mobile apps can connect immediately
4. Runs a **health check** (API up, DB reachable, embeddings working, storage writable) and prints the URL + a QR code to connect the mobile app

Re-running the wizard later (`kloop setup --reconfigure`) safely edits an existing install (e.g. switch from bundled Postgres to Supabase, change LLM provider).

### Path B — Clone & configure (for tinkerers and contributors)

```bash
git clone https://github.com/<org>/kloop.git
cd kloop
cp .env.example .env        # every variable documented inline
docker compose up -d        # api + workers + postgres/pgvector + minio
docker compose exec api kloop migrate && kloop admin create
```

- `docker compose up` is the **production-capable** default — not a toy dev mode
- `docker compose -f compose.dev.yml up` adds hot-reload, seeded demo data, and a mail-catcher for testing email-in
- A `compose.external-db.yml` overlay drops the bundled Postgres/MinIO for teams pointing at Supabase/S3

### Upgrades & operations

- `kloop upgrade` (or `docker compose pull && up -d`) — migrations run automatically on boot, and are always backward-compatible one version back
- `kloop backup` / `kloop restore` — one-command dump of DB + storage
- `kloop doctor` — the same health check the wizard runs, for debugging any install
- Versioned images (`kloop/server:1.x`), no `latest`-tag surprises

The rule for both paths: **from zero to a working instance in under 10 minutes, without reading anything but the prompts.**

---

## 11. Non-Negotiable Design Principles

1. **Capture must take <30 seconds** or supporters won't do it and the flywheel dies.
2. **Human review before anything becomes canonical knowledge.** AI proposes; humans approve.
3. **Docs are exportable plain Markdown** — no lock-in, git-syncable.
4. **BYO-LLM** including fully local (Ollama) — the orgs that choose OSS choose it for data control.
5. **Docker-based everything, two setup paths.** Clone + `docker compose up` for tinkerers, or a guided terminal wizard for everyone else — both must reach a production install in under 10 minutes. Postgres+pgvector is the only hard dependency.
6. **Domain-agnostic** — no IT assumptions; taxonomies emerge from usage.
7. **Deflection rate is the north star**, not tickets closed.

---

## 12. Roadmap

**Phase 1 — The loop, minimally (MVP)**
- Web app (both roles), email-in
- Request → resolve → capture → single-article generation → review inbox → publish
- Hybrid search deflection, supporter precedents
- Docker compose deploy + interactive setup wizard (`create-kloop`), BYO-LLM, Postgres/pgvector (incl. Supabase)

**Phase 2 — Mobile + intelligence**
- React Native app with server-connect flow (discovery document, QR, multi-org)
- Voice/photo capture with transcription/OCR
- Clustering, gap detection, freshness scoring
- Merge candidate detection + merge review UI

**Phase 3 — Automation + insights**
- Automation tiers 1–3
- Manager dashboard (deflection, coverage map, heatmaps)
- Slack/Teams intake, webhooks/API polish, SSO

**Phase 4 — Ecosystem**
- Git-sync for docs, public KB portal mode, plugin/adapter system
- Optional dedicated vector DB adapter for extreme scale

---

## License

TBD — recommendation: **AGPL-3.0** (protects against closed-source SaaS forks while staying fully open) or **Apache-2.0** (maximum adoption). Decide based on whether a future hosted offering is planned.