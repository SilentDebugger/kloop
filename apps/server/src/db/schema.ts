/**
 * kloop data model — implements the sketch in documentation.md §8.
 *
 * Conventions:
 *  - every tenant-scoped table carries org_id (hard tenant isolation; every
 *    query and every vector search filters on it)
 *  - everything textual that participates in matching has an `embedding`
 *    vector column + `embedding_status` for the async pipeline
 *  - tsvector columns (generated) power the keyword half of hybrid search
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/** Dimension is fixed at migration time; see EMBEDDING_DIMENSIONS in .env.example. */
export const EMBEDDING_DIM = 1536;

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const embeddingStatus = () => text("embedding_status").notNull().default("pending"); // pending | ok | skipped | failed

// ---------------------------------------------------------------------------
// Tenancy & identity
// ---------------------------------------------------------------------------

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  domain: text("domain"),
  logoUrl: text("logo_url"),
  /** theme: { primary, background, ... } applied by web + mobile via discovery doc */
  theme: jsonb("theme").$type<Record<string, string>>().notNull().default({}),
  /**
   * settings: {
   *   automationTier: 0|1|2|3,
   *   tagTierOverrides: { [tag]: 0|1|2|3 },
   *   authMethods: { magicLink: bool, password: bool, oidc: bool },
   *   oidc?: { issuer, clientId, clientSecret, buttonLabel },
   *   emailInEnabled: bool,
   *   reopenGraceDays: number,
   *   autoAnswerConfidence: number (0-1),
   * }
   */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("requester"), // requester | supporter | admin
    passwordHash: text("password_hash"),
    language: text("language").notNull().default("en"),
    /** { replies: bool, statusChanges: bool, reviewItems: bool } */
    notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean>>().notNull()
      .default({ replies: true, statusChanges: true, reviewItems: false }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_org_email_idx").on(t.orgId, t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const magicLinkTokens = pgTable("magic_link_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("requester"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull().default("expo"), // expo | web
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("push_tokens_user_token_idx").on(t.userId, t.token)],
);

// ---------------------------------------------------------------------------
// Requests & conversations
// ---------------------------------------------------------------------------

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    /** Human-friendly sequential ref per org, e.g. REQ-1284 (assigned by app code). */
    refNumber: integer("ref_number").notNull(),
    /** null = guest request: logged by a supporter for someone without an account */
    authorId: uuid("author_id").references(() => users.id),
    /** display name of that guest (walk-up, phone call) */
    guestName: text("guest_name"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status").notNull().default("open"), // open | handled | solved
    channel: text("channel").notNull().default("web"), // web | mobile | email | api
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    claimedBy: uuid("claimed_by").references(() => users.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    solvedAt: timestamp("solved_at", { withTimezone: true }),
    /** solved via deflection: which article self-solved it */
    selfSolvedArticleId: uuid("self_solved_article_id"),
    autoAnswered: boolean("auto_answered").notNull().default(false),
    escalated: boolean("escalated").notNull().default(false),
    /** "Did this fix it?" loop: none | pending | confirmed | rejected */
    confirmationState: text("confirmation_state").notNull().default("none"),
    satisfaction: integer("satisfaction"), // optional 1-5 rating
    reopenCount: integer("reopen_count").notNull().default(0),
    clusterId: uuid("cluster_id"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    embeddingModel: text("embedding_model"),
    embeddingStatus: embeddingStatus(),
    searchText: tsvector("search_text").generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))`,
    ),
    unreadForRequester: boolean("unread_for_requester").notNull().default(false),
    unreadForSupporter: boolean("unread_for_supporter").notNull().default(true),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("requests_org_ref_idx").on(t.orgId, t.refNumber),
    index("requests_org_status_idx").on(t.orgId, t.status),
    index("requests_org_author_idx").on(t.orgId, t.authorId),
    index("requests_org_claimed_idx").on(t.orgId, t.claimedBy),
    index("requests_cluster_idx").on(t.clusterId),
    index("requests_embedding_status_idx").on(t.embeddingStatus),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
    /** null author = system (auto-answers, status events) */
    authorId: uuid("author_id").references(() => users.id),
    kind: text("kind").notNull().default("message"), // message | internal_note | auto_answer | system
    body: text("body").notNull(),
    /** for auto_answer: the article that was sent */
    articleId: uuid("article_id"),
    /** AI-drafted reply that was edited/sent by a human */
    fromAiDraft: boolean("from_ai_draft").notNull().default(false),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    embeddingStatus: embeddingStatus(),
    searchText: tsvector("search_text").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`to_tsvector('simple', coalesce(body, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_request_idx").on(t.requestId, t.createdAt),
    index("messages_search_gin").using("gin", t.searchText),
  ],
);

export const resolutions = pgTable(
  "resolutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
    supporterId: uuid("supporter_id").notNull().references(() => users.id),
    rawCaptureText: text("raw_capture_text").notNull().default(""),
    captureKind: text("capture_kind").notNull().default("text"), // text | voice | photo | command | mixed
    structuredSummary: text("structured_summary"),
    /** requester confirmed the fix → trusted resolution signal */
    trusted: boolean("trusted").notNull().default(false),
    /** "same as last time" link */
    linkedResolutionId: uuid("linked_resolution_id"),
    /** set when this resolution has been distilled into an article */
    articleId: uuid("article_id"),
    /**
     * Documentation pipeline state — what the AI did with this capture:
     * working | drafted | already_documented | covered_by_draft | skipped | failed
     */
    docState: text("doc_state").notNull().default("working"),
    /** human-readable outcome ("Covered by KB-041 · VPN drops on hotel Wi-Fi") */
    docNote: text("doc_note"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    embeddingStatus: embeddingStatus(),
    searchText: tsvector("search_text").generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`to_tsvector('simple', coalesce(raw_capture_text, '') || ' ' || coalesce(structured_summary, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("resolutions_org_idx").on(t.orgId),
    index("resolutions_request_idx").on(t.requestId),
    index("resolutions_article_idx").on(t.articleId),
    index("resolutions_embedding_status_idx").on(t.embeddingStatus),
  ],
);

// ---------------------------------------------------------------------------
// Knowledge: clusters, articles (block trees), revisions, provenance
// ---------------------------------------------------------------------------

export const clusters = pgTable(
  "clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    centroid: vector("centroid", { dimensions: EMBEDDING_DIM }),
    label: text("label"),
    requestCount: integer("request_count").notNull().default(0),
    /** article covering this cluster (null = documentation gap candidate) */
    articleId: uuid("article_id"),
    /** total minutes spent on requests in this cluster (gap ranking = mass x cost) */
    totalMinutesSpent: real("total_minutes_spent").notNull().default(0),
    lastRequestAt: timestamp("last_request_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clusters_org_idx").on(t.orgId)],
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    /** Human-friendly KB number per org, e.g. KB-041 */
    kbNumber: integer("kb_number").notNull(),
    currentRevisionId: uuid("current_revision_id"),
    status: text("status").notNull().default("draft"), // draft | published | tombstone
    /** tombstones redirect forever (301-style) */
    redirectToArticleId: uuid("redirect_to_article_id"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    confidence: real("confidence").notNull().default(0.5),
    freshnessScore: real("freshness_score").notNull().default(1),
    staleFlag: boolean("stale_flag").notNull().default(false),
    staleReason: text("stale_reason"),
    helpfulCount: integer("helpful_count").notNull().default(0),
    notHelpfulCount: integer("not_helpful_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    /** count of requests solved by this article (deflections + confirmations) */
    solveCount: integer("solve_count").notNull().default(0),
    /** summary vector over title+summary for merge scan & retrieval */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    embeddingModel: text("embedding_model"),
    embeddingStatus: embeddingStatus(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("articles_org_kb_idx").on(t.orgId, t.kbNumber),
    index("articles_org_status_idx").on(t.orgId, t.status),
    index("articles_embedding_status_idx").on(t.embeddingStatus),
  ],
);

export const articleRevisions = pgTable(
  "article_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    createdByKind: text("created_by_kind").notNull().default("ai"), // ai | user
    createdById: uuid("created_by_id").references(() => users.id),
    parentRevisionId: uuid("parent_revision_id"),
    approvedBy: uuid("approved_by").references(() => users.id),
    changeNote: text("change_note"),
    searchText: tsvector("search_text").generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("article_revisions_article_idx").on(t.articleId)],
);

export const articleBlocks = pgTable(
  "article_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id").notNull().references(() => articleRevisions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // symptoms | environment | resolution | notes
    position: integer("position").notNull().default(0),
    /** e.g. "macOS 14.4+" — conditions resolution branches after merges */
    conditionText: text("condition_text"),
    contentMd: text("content_md").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    embeddingStatus: embeddingStatus(),
    searchText: tsvector("search_text").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`to_tsvector('simple', coalesce(content_md, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("article_blocks_revision_idx").on(t.revisionId, t.position),
    index("article_blocks_article_idx").on(t.articleId),
    index("article_blocks_embedding_status_idx").on(t.embeddingStatus),
  ],
);

export const provenance = pgTable(
  "provenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleBlockId: uuid("article_block_id").notNull().references(() => articleBlocks.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(), // request | resolution
    sourceId: uuid("source_id").notNull(),
  },
  (t) => [index("provenance_block_idx").on(t.articleBlockId)],
);

/**
 * "See also" crosslinks between articles: different problems that share a fix.
 * Created automatically by the merge scan's crosslink verdict (crosslinks
 * don't rewrite knowledge, so no human review) — stored once per pair with
 * articleAId < articleBId, rendered bidirectionally.
 */
export const articleLinks = pgTable(
  "article_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    articleAId: uuid("article_a_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    articleBId: uuid("article_b_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("crosslink"), // crosslink (scan) | manual
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("article_links_pair_idx").on(t.articleAId, t.articleBId),
    index("article_links_org_idx").on(t.orgId),
  ],
);

export const mergeCandidates = pgTable(
  "merge_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    articleAId: uuid("article_a_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    articleBId: uuid("article_b_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    /** { simSummary, simSymptoms, simResolution, clusterOverlap, coRetrieval, entityOverlap } */
    scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
    compositeScore: real("composite_score").notNull().default(0),
    status: text("status").notNull().default("proposed"), // proposed | approved | rejected | suppressed
    verdict: text("verdict"), // merge | branch | crosslink | fork
    /**
     * LLM proposal: { rationale, confidence, diff: [{ op, blockKind, text, from }],
     *                 mergedTitle, mergedSummary, blocks: [{kind, conditionText, contentMd, origin}] }
     */
    proposal: jsonb("proposal").$type<Record<string, unknown>>(),
    proposalRevisionId: uuid("proposal_revision_id"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merge_candidates_pair_idx").on(t.articleAId, t.articleBId),
    index("merge_candidates_org_status_idx").on(t.orgId, t.status),
  ],
);

/**
 * Unified review inbox: article drafts, proposed updates, merge proposals.
 * One row per pending human decision — badge counts and the Reviews screen
 * read straight from here.
 */
export const reviewItems = pgTable(
  "review_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // draft | update | merge | stale
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id").references(() => articleRevisions.id, { onDelete: "cascade" }),
    mergeCandidateId: uuid("merge_candidate_id").references(() => mergeCandidates.id, { onDelete: "cascade" }),
    confidence: real("confidence").notNull().default(0.5),
    /** short context, e.g. "From 3 resolutions · Maya, Tomas" */
    context: text("context"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("review_items_org_status_idx").on(t.orgId, t.status)],
);

// ---------------------------------------------------------------------------
// Attachments, events, notifications, integration surface
// ---------------------------------------------------------------------------

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ownerKind: text("owner_kind").notNull(), // request | message | resolution | article
    ownerId: uuid("owner_id").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    storageKey: text("storage_key").notNull(),
    kind: text("kind").notNull().default("file"), // image | audio | file
    /** OCR / transcript text, mined + embedded */
    extractedText: text("extracted_text"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    embeddingStatus: embeddingStatus(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_owner_idx").on(t.ownerKind, t.ownerId)],
);

/** Append-only audit log; doubles as the learning-signal store. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    actorKind: text("actor_kind").notNull().default("system"), // user | system | ai
    actorId: uuid("actor_id"),
    type: text("type").notNull(),
    // e.g. deflection_shown, deflection_accepted, auto_answer_sent, auto_answer_confirmed,
    //      request_created, request_solved, article_published, merge_approved, search_results, ...
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_org_type_idx").on(t.orgId, t.type, t.createdAt),
    index("events_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // reply | status_change | review_item | gap_alert | system
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** deep link path, e.g. /requests/<id> */
    linkPath: text("link_path"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  /** first 8 chars shown in the UI for identification */
  tokenPrefix: text("token_prefix").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  /** event types to deliver; empty = all */
  events: text("events").array().notNull().default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  lastStatus: integer("last_status"),
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * AI usage ledger — one row per provider API call, with the token counts the
 * provider itself reported (never client-side estimates unless `exact` is
 * false). Cost is computed at insert time from the pricing table and stored,
 * so analytics stay correct even if rates change later; raw counts allow
 * recomputation.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // openai | gemini | anthropic | ollama
    model: text("model").notNull(),
    /** complete | ocr | transcribe | embed_text | embed_media */
    operation: text("operation").notNull(),
    /** what the call was for: reply_draft, article_draft, search_query, embed_request, ... */
    purpose: text("purpose"),
    /** prompt tokens as reported by the provider (includes cached tokens) */
    inputTokens: integer("input_tokens").notNull().default(0),
    /** subset of input tokens served from the provider's prompt cache (billed at the cached rate) */
    cachedTokens: integer("cached_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** image/audio tokens for multimodal embeddings (billed at modality rates) */
    imageTokens: integer("image_tokens").notNull().default(0),
    audioTokens: integer("audio_tokens").notNull().default(0),
    /** audio duration for per-minute-billed transcription (whisper) */
    mediaSeconds: real("media_seconds").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    /** false when the provider reported no usage and counts were estimated */
    exact: boolean("exact").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_org_created_idx").on(t.orgId, t.createdAt)],
);

/** Per-org sequential counters (REQ-xxxx, KB-xxx) — bumped atomically. */
export const counters = pgTable(
  "counters",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // request | article
    value: integer("value").notNull().default(0),
  },
  (t) => [uniqueIndex("counters_org_name_idx").on(t.orgId, t.name)],
);
