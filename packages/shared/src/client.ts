/**
 * Typed kloop API client — the single transport used by web and mobile.
 * Configure once with base URL + token/org getters; every call is a thin,
 * typed wrapper over fetch.
 */
import type {
  ArticleListItem,
  ArticleView,
  AuthMethods,
  DeflectionSuggestion,
  DiscoveryDoc,
  MessageView,
  NotificationView,
  OnboardingStatus,
  Precedents,
  RequestDetail,
  RequestSummary,
  ReviewCounts,
  ReviewListItem,
  Role,
  SearchResults,
  SessionUser,
} from "./types.js";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type ClientConfig = {
  /** "" for same-origin (web) or a function returning the active server origin (mobile) */
  baseUrl: string | (() => string);
  getToken?: () => string | null;
  /** org slug header for multi-org servers (mobile) */
  getOrgSlug?: () => string | null;
};

export class KloopClient {
  constructor(private cfg: ClientConfig) {}

  private base(): string {
    return typeof this.cfg.baseUrl === "function" ? this.cfg.baseUrl() : this.cfg.baseUrl;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };
    const token = this.cfg.getToken?.();
    if (token) headers.authorization = `Bearer ${token}`;
    const org = this.cfg.getOrgSlug?.();
    if (org) headers["x-kloop-org"] = org;

    const res = await fetch(`${this.base()}${path}`, { ...init, headers });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & T;
    if (!res.ok) {
      throw new ApiError(res.status, String((data as Record<string, unknown>).error ?? `request failed (${res.status})`));
    }
    return data;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }
  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body: body === undefined ? "{}" : JSON.stringify(body) });
  }
  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PUT", body: JSON.stringify(body) });
  }
  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  }
  private del<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: "DELETE", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }

  // ---- discovery & auth ----
  static async discover(origin: string): Promise<DiscoveryDoc> {
    const url = `${origin.replace(/\/$/, "")}/.well-known/kloop.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new ApiError(res.status, "not a kloop server");
    const doc = (await res.json()) as DiscoveryDoc;
    if (!doc.kloop) throw new ApiError(400, "not a kloop server");
    return doc;
  }

  authMethods() {
    return this.get<AuthMethods>("/api/auth/methods");
  }
  login(email: string, password: string) {
    return this.post<{ token: string; user: SessionUser }>("/api/auth/login", { email, password });
  }
  requestMagicLink(email: string) {
    return this.post<{ ok: true }>("/api/auth/magic-link", { email });
  }
  verifyMagicLink(token: string) {
    return this.post<{ token: string; user: SessionUser }>("/api/auth/verify", { token });
  }
  acceptInvite(token: string, name: string, password: string) {
    return this.post<{ token: string; user: SessionUser }>("/api/auth/accept-invite", { token, name, password });
  }
  me() {
    return this.get<{ user: SessionUser }>("/api/auth/me");
  }
  logout() {
    return this.post<{ ok: true }>("/api/auth/logout");
  }
  updateProfile(patch: { name?: string; language?: string; notificationPrefs?: Record<string, boolean>; password?: string }) {
    return this.patch<{ user: SessionUser }>("/api/auth/profile", patch);
  }
  registerPushToken(token: string, platform = "expo") {
    return this.post<{ ok: true }>("/api/auth/push-token", { token, platform });
  }
  deletePushToken(token: string) {
    return this.del<{ ok: true }>("/api/auth/push-token", { token });
  }

  // ---- org ----
  org() {
    return this.get<{ org: Record<string, unknown> }>("/api/org");
  }
  updateOrg(patch: Record<string, unknown>) {
    return this.patch<{ org: Record<string, unknown> }>("/api/org", patch);
  }
  orgUsers() {
    return this.get<{ users: { id: string; email: string; name: string; role: string; createdAt: string; lastSeenAt: string | null; deactivatedAt: string | null }[] }>("/api/org/users");
  }
  updateUser(id: string, patch: { role?: string; deactivated?: boolean }) {
    return this.patch<{ user: Record<string, unknown> }>(`/api/org/users/${id}`, patch);
  }
  createUser(input: { name: string; email: string; password: string; role: string }) {
    return this.post<{ user: { id: string } }>("/api/org/users", input);
  }
  invitations() {
    return this.get<{ invitations: { id: string; email: string; role: string; createdAt: string }[] }>("/api/org/invitations");
  }
  invite(email: string, role: string) {
    return this.post<{ invitation: { id: string } }>("/api/org/invitations", { email, role });
  }
  revokeInvitation(id: string) {
    return this.del<{ ok: true }>(`/api/org/invitations/${id}`);
  }
  onboarding() {
    return this.get<OnboardingStatus>("/api/org/onboarding");
  }
  dismissOnboarding() {
    return this.patch<{ org: Record<string, unknown> }>("/api/org", { settings: { onboardingDismissed: true } });
  }

  // ---- requests ----
  createRequest(input: {
    title: string;
    body?: string;
    channel?: string;
    tags?: string[];
    attachmentIds?: string[];
    /** supporters only: log the request for an existing user or a guest */
    onBehalf?: { userId?: string; guestName?: string };
  }) {
    return this.post<{ request: RequestSummary }>("/api/requests", input);
  }
  /** Supporter people picker (active org users). */
  directory() {
    return this.get<{ users: { id: string; name: string; email: string; role: Role }[] }>("/api/org/directory");
  }
  selfSolve(input: { title: string; body?: string; articleId: string }) {
    return this.post<{ request: RequestSummary }>("/api/requests/self-solve", input);
  }
  requests(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get<{ requests: RequestSummary[] }>(`/api/requests${qs ? `?${qs}` : ""}`);
  }
  requestDetail(id: string) {
    return this.get<RequestDetail>(`/api/requests/${id}`);
  }
  postMessage(requestId: string, input: { body: string; kind?: "message" | "internal_note"; fromAiDraft?: boolean; attachmentIds?: string[] }) {
    return this.post<{ message: MessageView }>(`/api/requests/${requestId}/messages`, input);
  }
  claim(requestId: string) {
    return this.post<{ request: RequestSummary }>(`/api/requests/${requestId}/claim`);
  }
  assign(requestId: string, userId: string | null) {
    return this.post<{ request: RequestSummary }>(`/api/requests/${requestId}/assign`, { userId });
  }
  confirm(requestId: string, fixed: boolean) {
    return this.post<{ request: RequestSummary }>(`/api/requests/${requestId}/confirm`, { fixed });
  }
  reopen(requestId: string) {
    return this.post<{ request: RequestSummary }>(`/api/requests/${requestId}/reopen`);
  }
  rate(requestId: string, satisfaction: number) {
    return this.post<{ ok: true }>(`/api/requests/${requestId}/rate`, { satisfaction });
  }
  resolve(requestId: string, input: { rawCaptureText?: string; captureKind?: string; linkedResolutionId?: string | null; attachmentIds?: string[]; skipCapture?: boolean }) {
    return this.post<{ request: RequestSummary; resolutionId: string | null }>(`/api/requests/${requestId}/resolve`, input);
  }
  /** AI-drafted "what fixed it" capture text, generated from the full thread. */
  resolutionDraft(requestId: string) {
    return this.post<{ draft: string }>(`/api/requests/${requestId}/resolution-draft`, {});
  }
  precedents(requestId: string) {
    return this.get<Precedents>(`/api/requests/${requestId}/precedents`);
  }
  similarResolutions(requestId: string) {
    return this.get<{ resolutions: { id: string; ref: string; requestTitle: string; summary: string; supporterName: string | null; createdAt: string }[] }>(`/api/requests/${requestId}/similar-resolutions`);
  }
  aiDraft(requestId: string) {
    return this.get<{ draft: { body: string; groundedIn: { articleId: string | null; articleTitle: string | null } } | null }>(`/api/requests/${requestId}/ai-draft`);
  }

  // ---- deflection & search ----
  deflect(text: string, attachmentIds: string[] = []) {
    return this.post<{ suggestions: DeflectionSuggestion[]; pendingAttachments: number }>("/api/deflect", { text, attachmentIds });
  }
  /** Global hybrid search. Photos/voice notes join the query via `attachmentIds`. */
  search(q: string, attachmentIds: string[] = []) {
    const att = attachmentIds.length > 0 ? `&att=${attachmentIds.join(",")}` : "";
    return this.get<SearchResults>(`/api/search?q=${encodeURIComponent(q)}${att}`);
  }

  // ---- articles ----
  articles(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get<{ articles: ArticleListItem[]; tags: { tag: string; n: number }[] }>(`/api/articles${qs ? `?${qs}` : ""}`);
  }
  article(id: string) {
    return this.get<ArticleView>(`/api/articles/${id}`);
  }
  articleFeedback(id: string, helpful: boolean) {
    return this.post<{ ok: true }>(`/api/articles/${id}/feedback`, { helpful });
  }
  createArticle(input: { title: string; summary?: string; tags?: string[]; blocks: { kind: string; contentMd: string; conditionText?: string | null }[]; attachmentIds?: string[]; publish?: boolean }) {
    return this.post<{ article: { id: string; kb: string } }>("/api/articles", input);
  }
  updateArticle(id: string, input: { title: string; summary?: string; tags?: string[]; blocks: { kind: string; contentMd: string; conditionText?: string | null }[]; attachmentIds?: string[]; removeAttachmentIds?: string[]; changeNote?: string; publish?: boolean }) {
    return this.put<{ ok: true; revisionId: string }>(`/api/articles/${id}`, input);
  }
  archiveArticle(id: string, redirectToArticleId: string | null = null) {
    return this.post<{ ok: true }>(`/api/articles/${id}/archive`, { redirectToArticleId });
  }

  // ---- reviews ----
  reviewCounts() {
    return this.get<{ counts: ReviewCounts }>("/api/reviews/counts");
  }
  reviews(kind?: string) {
    return this.get<{ items: ReviewListItem[] }>(`/api/reviews${kind ? `?kind=${kind}` : ""}`);
  }
  review(id: string) {
    return this.get<Record<string, unknown>>(`/api/reviews/${id}`);
  }
  approveReview(id: string, edits?: { title: string; summary: string; blocks: { kind: string; contentMd: string; conditionText?: string | null }[] }) {
    return this.post<{ ok: true }>(`/api/reviews/${id}/approve`, edits ? { edits } : {});
  }
  rejectReview(id: string) {
    return this.post<{ ok: true }>(`/api/reviews/${id}/reject`);
  }
  /** Merge the reviewed draft into an existing published article — creates a merge proposal for review. */
  reviewMergeInto(id: string, articleId: string) {
    return this.post<{ ok: true; mergeReviewItemId: string }>(`/api/reviews/${id}/merge-into`, { articleId });
  }

  // ---- insights ----
  gaps() {
    return this.get<{
      gaps: { clusterId: string; label: string | null; requestCount: number; minutesSpent: number; lastRequestAt: string | null; sampleTitles: string[] }[];
      staleArticles: { id: string; kb: string; title: string; freshnessScore: number; staleReason: string | null; updatedAt: string }[];
    }>("/api/insights/gaps");
  }
  insights(days = 30) {
    return this.get<Record<string, never> & {
      windowDays: number;
      requests: { total: number; solved: number; escalated: number; avgSolveMinutes: number };
      deflection: { selfSolved: number; autoAnswered: number; rate: number; timeSavedHours: number };
      knowledge: { published: number; drafts: number; stale: number; clusterCoverage: number };
      recurringIssues: { clusterId: string; label: string | null; covered: boolean; recentRequests: number }[];
      trend: { week: string; requests: number; deflected: number }[];
      ai: {
        totalCostUsd: number;
        calls: number;
        estimatedCalls: number;
        cacheSavingsUsd: number;
        tokens: { input: number; cached: number; output: number; media: number };
        byModel: {
          provider: string;
          model: string;
          calls: number;
          costUsd: number;
          inputTokens: number;
          cachedTokens: number;
          outputTokens: number;
          mediaTokens: number;
          mediaSeconds: number;
        }[];
        byPurpose: { purpose: string; calls: number; costUsd: number }[];
        byDay: { day: string; calls: number; costUsd: number }[];
      };
    }>(`/api/insights?days=${days}`);
  }

  // ---- notifications ----
  notifications() {
    return this.get<{ unread: number; notifications: NotificationView[] }>("/api/notifications");
  }
  markNotificationRead(id: string) {
    return this.post<{ ok: true }>(`/api/notifications/${id}/read`);
  }
  markAllNotificationsRead() {
    return this.post<{ ok: true }>("/api/notifications/read-all");
  }

  // ---- attachments ----
  async upload(file: { blob: Blob; name: string }): Promise<{ attachment: { id: string; filename: string; mimeType: string; kind: string } }> {
    const form = new FormData();
    form.append("file", file.blob, file.name);
    return this.request("/api/attachments", { method: "POST", body: form });
  }
  /** Raw media URL. Carries the token in the query — native Image/audio loaders can't set headers. */
  attachmentRawUrl(id: string): string {
    const token = this.cfg.getToken?.();
    return `${this.base()}/api/attachments/${id}/raw${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }

  // ---- integrations (admin) ----
  apiKeys() {
    return this.get<{ apiKeys: { id: string; name: string; tokenPrefix: string; lastUsedAt: string | null; createdAt: string }[] }>("/api/integrations/api-keys");
  }
  createApiKey(name: string) {
    return this.post<{ apiKey: { id: string; name: string; token: string } }>("/api/integrations/api-keys", { name });
  }
  revokeApiKey(id: string) {
    return this.del<{ ok: true }>(`/api/integrations/api-keys/${id}`);
  }
  webhooks() {
    return this.get<{ webhooks: { id: string; url: string; events: string[]; active: boolean; lastStatus: number | null; lastDeliveryAt: string | null }[] }>("/api/integrations/webhooks");
  }
  createWebhook(url: string, events: string[]) {
    return this.post<{ webhook: { id: string; url: string; events: string[]; secret: string } }>("/api/integrations/webhooks", { url, events });
  }
  updateWebhook(id: string, patch: { active?: boolean; events?: string[]; url?: string }) {
    return this.patch<{ ok: true }>(`/api/integrations/webhooks/${id}`, patch);
  }
  deleteWebhook(id: string) {
    return this.del<{ ok: true }>(`/api/integrations/webhooks/${id}`);
  }
  channels() {
    return this.get<{ emailIn: { configured: boolean; endpoint: string; enabled: boolean }; api: { baseUrl: string; discoveryUrl: string } }>("/api/integrations/channels");
  }

  /** SSE stream URL (EventSource can't set headers — token goes in the query). */
  streamUrl(): string {
    const token = this.cfg.getToken?.();
    return `${this.base()}/api/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }
}
