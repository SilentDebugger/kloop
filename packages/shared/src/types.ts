/** API shapes shared by web + mobile (server responses, narrowed to what clients use). */

export type Role = "requester" | "supporter" | "admin";
export type RequestStatus = "open" | "handled" | "solved";
export type ConfirmationState = "none" | "pending" | "confirmed" | "rejected";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  language: string;
  notificationPrefs: Record<string, boolean>;
};

export type PersonRef = { id: string; name: string; email?: string; role?: Role } | null;

/** Latest customer-facing message on a request, for inbox-style reply previews. */
export type LastMessagePreview = {
  /** null for AI auto-answers or when the sender's account no longer resolves */
  authorName: string | null;
  fromAi: boolean;
  body: string;
  createdAt: string;
};

export type RequestSummary = {
  id: string;
  ref: string;
  title: string;
  body: string;
  /** set when a supporter logged this for someone without an account */
  guestName: string | null;
  status: RequestStatus;
  channel: "web" | "mobile" | "email" | "api";
  tags: string[];
  claimedBy: string | null;
  confirmationState: ConfirmationState;
  autoAnswered: boolean;
  escalated: boolean;
  selfSolvedArticleId: string | null;
  unreadForRequester: boolean;
  unreadForSupporter: boolean;
  createdAt: string;
  solvedAt: string | null;
  lastActivityAt: string;
  author?: PersonRef;
  claimer?: PersonRef;
  authorPastRequests?: number;
  lastMessage?: LastMessagePreview | null;
};

export type MessageView = {
  id: string;
  kind: "message" | "internal_note" | "auto_answer" | "system";
  body: string;
  articleId?: string | null;
  fromAiDraft?: boolean;
  author: PersonRef;
  createdAt: string;
  attachments?: AttachmentRef[];
};

export type AttachmentRef = { id: string; filename: string; mimeType: string; kind: "image" | "audio" | "file" };

export type ResolutionView = {
  id: string;
  captureKind: string;
  rawCaptureText: string;
  structuredSummary: string | null;
  trusted: boolean;
  linkedResolutionId: string | null;
  articleId: string | null;
  docState: DocState;
  docNote: string | null;
  createdAt: string;
  supporterName: string | null;
  attachments: AttachmentRef[];
};

/** Documentation pipeline state for a resolution — what the AI did with it. */
export type DocState =
  | "working"
  | "waiting_confirmation"
  | "drafted"
  | "already_documented"
  | "covered_by_draft"
  | "skipped"
  | "failed";

/** One row of the supporter-facing "AI activity" feed. */
export type AiActivityItem = {
  id: string;
  requestId: string;
  requestRef: string;
  requestTitle: string;
  supporterName: string;
  createdAt: string;
  state: DocState;
  note: string | null;
  articleId: string | null;
  reviewItemId: string | null;
};

/** Admin onboarding checklist: steps derive from live data, so they self-complete. */
export type OnboardingStepId = "invite_team" | "choose_tier" | "publish_article" | "first_request" | "connect_email";

export type OnboardingStatus = {
  steps: { id: OnboardingStepId; done: boolean }[];
  dismissed: boolean;
  complete: boolean;
};

/** Supporter-only: why the AI declined to auto-answer this request. */
export type AutoAnswerSkip = {
  reason: "tag_tier_override" | "no_article_match" | "below_confidence" | "article_has_no_steps" | "generation_failed";
  similarity?: number;
  threshold?: number;
  articleId?: string;
  articleTitle?: string | null;
  createdAt: string;
};

export type RequestDetail = {
  request: RequestSummary;
  messages: MessageView[];
  attachments: AttachmentRef[];
  resolutions: ResolutionView[];
  autoAnswerSkip?: AutoAnswerSkip;
};

export type DeflectionSuggestion = {
  kind: "article";
  id: string;
  kb: string;
  title: string;
  summary: string;
  helpfulPercent: number | null;
  score: number;
};

/** Global hybrid search response — sectioned so clients can render clean groups. */
export type SearchResults = {
  articles: { id: string; kb: string; title: string; summary: string; helpfulCount: number; notHelpfulCount: number }[];
  requests: { id: string; ref: string; title: string; status: string; solvedAt: string | null; createdAt: string }[];
  messages: { id: string; requestId: string; ref: string; requestTitle: string; internal: boolean; snippet: string; createdAt: string }[];
  resolutions: { id: string; requestId: string; summary: string; createdAt: string }[];
  /** query attachments whose OCR/transcription hasn't landed yet — re-ask while > 0 */
  pendingAttachments: number;
};

/** One topic the doc-gen pipeline found inside a knowledge capture. */
export type DocCaptureTopicView = {
  id: string;
  title: string;
  kind: "how-to" | "onboarding" | "good-to-know" | "other";
  summary: string;
  sourceHint: string;
  status: "pending" | "drafted" | "covered" | "failed" | "discarded";
  articleId?: string;
  coveredByLabel?: string;
};

/** A supporter knowledge brain-dump being split into draft articles. */
export type DocCaptureView = {
  id: string;
  status: "queued" | "reading" | "drafting" | "ready" | "submitted" | "cancelled" | "failed";
  rawText: string;
  topics: DocCaptureTopicView[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArticleListItem = {
  id: string;
  kb: string;
  title: string;
  summary: string;
  status: string;
  tags: string[];
  confidence: number;
  freshnessScore: number;
  staleFlag: boolean;
  helpfulCount: number;
  notHelpfulCount: number;
  solveCount: number;
  updatedAt: string;
};

export type ArticleBlockView = {
  id: string;
  kind: "symptoms" | "environment" | "resolution" | "notes";
  position: number;
  conditionText: string | null;
  contentMd: string;
};

export type ArticleView = {
  article: {
    id: string;
    kb: string;
    status: string;
    tags: string[];
    confidence: number;
    freshnessScore: number;
    staleFlag: boolean;
    staleReason: string | null;
    helpfulCount: number;
    notHelpfulCount: number;
    viewCount: number;
    solveCount: number;
    updatedAt: string;
    title: string;
    summary: string;
    revisionId: string;
  };
  blocks: ArticleBlockView[];
  /** photos / voice notes attached to the doc — vectorized and searchable */
  attachments?: AttachmentRef[];
  /** "See also" crosslinks (different problem, same fix) */
  related?: { id: string; kb: string; title: string }[];
  provenance?: { blockId: string; sourceKind: string; sourceId: string; ref: string | null }[];
  redirectTo?: string;
};

export type ReviewCounts = { draft: number; update: number; merge: number; stale: number; total: number };

export type ReviewListItem = {
  id: string;
  kind: "draft" | "update" | "merge" | "stale";
  articleId: string | null;
  revisionId: string | null;
  mergeCandidateId: string | null;
  confidence: number;
  context: string | null;
  createdAt: string;
  title: string | null;
  kb: string | null;
  staleReason: string | null;
};

export type Precedents = {
  similarSolved: {
    id: string;
    ref: string;
    title: string;
    solvedAt: string | null;
    resolution: { id: string; summary: string; supporterName: string | null; articleId: string | null } | null;
  }[];
  matchedArticles: { id: string; kb: string; title: string; summary: string }[];
};

export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
};

export type DiscoveryDoc = {
  kloop: true;
  version: number;
  apiBaseUrl: string;
  org: { name: string; slug: string; logoUrl: string | null; theme: Record<string, string> };
  auth: { magicLink: boolean; password: boolean; oidc: boolean };
};

export type AuthMethods = {
  org: { name: string; slug: string; logoUrl: string | null; theme: Record<string, string> };
  methods: { magicLink: boolean; password: boolean; oidc: false | { buttonLabel: string } };
};
