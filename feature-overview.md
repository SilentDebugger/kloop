# kloop — App Features & Views Overview

Feature and view inventory for the **mobile app** (identical scope applies to the web app — one shared list). No styling details; purely *what exists* per role.

Both roles live in **one app**. The visible surface depends on the logged-in user's role; supporters can switch into the requester view (they also submit requests sometimes).

---

## 0. Shared / App-Level (both roles)

### Features
- Server connect: enter domain or scan QR → fetch discovery document → org branding applied
- Multi-org support: add multiple servers, switch between them (workspace-style)
- Authentication: email magic link, password, SSO/OIDC (per org config)
- Push notifications (per-event configurable: replies, status changes, review items)
- Global search across requests + knowledge articles (hybrid search)
- Offline draft support: compose requests/captures offline, sync on reconnect
- Attachment handling: camera, photo library, file picker, voice recording
- Deep links (notification → exact request/article/review item)
- Profile & notification settings
- Language/localization support

### Views
1. **Server Connect / Onboarding** — domain entry or QR scan, org confirmation
2. **Login / Auth** — per-org auth methods
3. **Org Switcher** — list of connected orgs
4. **Global Search** — unified results (articles, requests), filterable
5. **Notifications Center** — chronological, tappable
6. **Settings / Profile** — account, notifications, language, connected orgs

---

## 1. Requester Side

### Features
- **One-box request creation**: single text field + optional attachments (photo, screenshot, voice note, file)
- **Live deflection**: while typing, matching knowledge articles and solved requests appear inline; one tap opens them
- **"This solved it" action**: closes the draft as self-solved (counts as automated resolution)
- Submit request → minimal status tracking: *open / being handled / solved* (nothing else exposed)
- Conversation thread per request: messages with the supporter, attachments both ways
- **"Did this fix it?" confirmation prompt** when a supporter marks a request resolved (yes → solved & trusted; no → reopens)
- Receive auto-answers (tier 2/3 orgs): system reply with matched article; "didn't help" escalates to a human automatically
- Browse & search the published knowledge base (self-service without creating a request)
- Article feedback: "helpful / not helpful" on any article
- Rate resolution (optional lightweight satisfaction signal)
- Reopen a solved request within a grace period
- View own request history

### Views
1. **Home / New Request** — the one-box composer with live doc suggestions underneath (this *is* the home screen; asking for help must be zero navigation)
2. **Suggested Answer Detail** — full article view from within the composer, with "this solved it" / "still need help" actions
3. **My Requests (list)** — open and past requests with minimal status
4. **Request Detail / Thread** — status, conversation, attachments, confirmation prompt, reopen action
5. **Knowledge Base Browser** — search + tag/category browsing of published articles
6. **Article View** — reader view with feedback actions and "create request about this" shortcut

---

## 2. Supporter Side

### Features
- **Queue**: incoming requests, filterable (unassigned / mine / all, tags, channel, age), sortable, with claim ("I'm handling this") action
- **AI precedents on open**: similar past requests + their resolutions and matching articles shown before/at ticket open
- Reply in thread (text, attachments), internal notes (never visible to requester)
- **AI-drafted replies** (tier 1+): suggested response based on matched knowledge, editable before send
- **Resolution capture (<30s)**: free text, voice memo (auto-transcribed), photo, pasted commands/logs — structured by the system afterwards
- **"Same as last time"**: one-tap link of current resolution to a previous one
- Mark resolved → triggers requester confirmation loop
- **Draft-review inbox**: approve / edit / reject AI-generated articles and article updates
- **Merge review**: side-by-side (3-pane) review of merge proposals with per-block accept/edit/reject
- Gap alerts: "recurring issue with no documentation" prompts
- Stale-doc flags: articles contradicted by recent resolutions surfaced for review
- Knowledge base management: create/edit articles manually, tag, archive (tombstone)
- Reassign / hand off a request to another supporter
- Personal workload overview (my open requests, my pending reviews)
- Quick-search all knowledge + past resolutions from anywhere (for mid-call lookup)

### Views
1. **Queue** — request list with filters, claim action, unread indicators
2. **Request Detail / Workbench** — the core screen: thread + requester context on one side, AI precedents & matched articles alongside; reply box with AI-draft option; internal notes toggle
3. **Resolution Capture** — appears on resolve: text/voice/photo capture, "same as last time" picker, done
4. **Review Inbox (list)** — pending article drafts, article updates, and merge proposals, badge-counted
5. **Article Draft Review** — AI draft with provenance (source tickets), inline editing, approve/reject
6. **Merge Review** — Article A | Article B | proposed merge, per-block actions, rationale shown
7. **Knowledge Base Manager** — all articles (incl. drafts/tombstones), search, filters (confidence, freshness, gaps), manual editor
8. **Article Editor** — block-based editing (symptoms / environment / resolution steps / notes)
9. **Gaps & Health** — undocumented recurring clusters ranked by impact, stale-doc list
10. **My Work** — personal dashboard: my claimed requests, my pending reviews

---

## 3. Admin / Manager Additions (supporter role, elevated)

*Kept minimal here — full insights layer is described in the main README.*

### Features
- Org settings: branding, auth methods, automation tier slider (global + per tag), LLM/embedding provider config
- User & role management, invitations
- Insights: deflection rate, knowledge coverage, recurring-issue heatmap, time-saved estimates
- Intake channel config (email-in address, webhooks)

### Views
1. **Insights Dashboard** — deflection, coverage, trends
2. **Org Settings** — branding, automation tiers, AI provider
3. **Users & Roles** — member management
4. **Channels & Integrations** — email-in, webhooks, API keys

---

## Priority note (MVP cut)

If phasing is needed, the minimum lovable app is:
- Requester: views 1–4
- Supporter: views 1–5
- Shared: views 1, 2, 6

Everything else (merge review, gaps, insights, multi-org) can land in later releases without breaking the core loop.