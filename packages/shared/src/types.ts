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

export type RequestSummary = {
  id: string;
  ref: string;
  title: string;
  body: string;
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
  createdAt: string;
};

export type RequestDetail = {
  request: RequestSummary;
  messages: MessageView[];
  attachments: AttachmentRef[];
  resolutions: ResolutionView[];
};

export type DeflectionSuggestion =
  | { kind: "article"; id: string; kb: string; title: string; summary: string; helpfulPercent: number | null; score: number }
  | { kind: "solved_request"; id: string; ref: string; title: string; solvedAt: string | null; resolutionMinutes: number | null; score: number };

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
