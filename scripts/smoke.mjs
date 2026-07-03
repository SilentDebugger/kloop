#!/usr/bin/env node
/**
 * kloop API smoke test — runs the core loop end-to-end against a dev server.
 * Uses the local dev database only (accounts created by `kloop admin create`
 * or `kloop seed`). Safe to run repeatedly.
 *
 *   node scripts/smoke.mjs [baseUrl] [email] [password]
 */
const base = process.argv[2] ?? "http://localhost:8787";
const email = process.argv[3] ?? "admin@test.local";
const password = process.argv[4] ?? "testtest123";

let failures = 0;
const results = [];

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (err) {
    failures++;
    results.push(`  ✗ ${name} — ${err.message}`);
    return false;
  }
}

async function api(path, opts = {}, token) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

let token = null;
let requestId = null;

await step("health", async () => {
  const r = await api("/api/health");
  if (!r.ok) throw new Error("not ok");
});

await step("discovery document", async () => {
  const r = await api("/.well-known/kloop.json");
  if (!r.kloop) throw new Error("missing kloop marker");
  return r.org.name;
});

await step("login", async () => {
  const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  token = r.token;
  return `${r.user.name} (${r.user.role})`;
});

await step("me", async () => {
  const r = await api("/api/auth/me", {}, token);
  if (r.user.email !== email.toLowerCase()) throw new Error("wrong user");
});

await step("create request", async () => {
  const r = await api(
    "/api/requests",
    {
      method: "POST",
      body: JSON.stringify({
        title: `Smoke test request ${Date.now()}`,
        body: "VPN keeps asking for my password since this morning's update.",
      }),
    },
    token,
  );
  requestId = r.request.id;
  return r.request.ref;
});

await step("post thread message", async () => {
  await api(
    `/api/requests/${requestId}/messages`,
    { method: "POST", body: JSON.stringify({ body: "Thread message from smoke test." }) },
    token,
  );
});

await step("request detail", async () => {
  const r = await api(`/api/requests/${requestId}`, {}, token);
  if (r.messages.length < 1) throw new Error("thread empty");
  return `${r.messages.length} message(s)`;
});

await step("request list", async () => {
  const r = await api("/api/requests?filter=all", {}, token);
  if (!Array.isArray(r.requests)) throw new Error("no list");
  return `${r.requests.length} visible`;
});

await step("notifications", async () => {
  const r = await api("/api/notifications", {}, token);
  return `${r.unread} unread`;
});

// --- the knowledge loop: resolve -> capture -> draft -> review -> publish -> deflect ---

await step("resolve with capture", async () => {
  const r = await api(
    `/api/requests/${requestId}/resolve`,
    {
      method: "POST",
      body: JSON.stringify({
        rawCaptureText:
          "Re-installed the VPN profile from Self Service, restarted the client. Root cause: the update invalidates the old profile cert.",
        captureKind: "text",
      }),
    },
    token,
  );
  if (r.request.confirmationState !== "pending") throw new Error("confirmation loop not triggered");
  return r.resolutionId ? "capture stored" : "no resolution";
});

let reviewItemId = null;
let draftArticleId = null;

await step("article draft appears in review inbox", async () => {
  for (let i = 0; i < 30; i++) {
    const r = await api("/api/reviews?kind=draft", {}, token);
    if (r.items.length > 0) {
      reviewItemId = r.items[0].id;
      draftArticleId = r.items[0].articleId;
      return `"${r.items[0].title}" (confidence ${r.items[0].confidence.toFixed(2)})`;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("no draft after 30s");
});

await step("draft review payload has blocks + sources", async () => {
  const r = await api(`/api/reviews/${reviewItemId}`, {}, token);
  if (!r.proposed?.blocks?.length) throw new Error("no blocks");
  return `${r.proposed.blocks.length} blocks, sources: ${r.sources.join(", ")}`;
});

await step("approve & publish draft", async () => {
  const r = await api(`/api/reviews/${reviewItemId}/approve`, { method: "POST", body: "{}" }, token);
  if (!r.ok) throw new Error("approve failed");
});

await step("published article view + markdown export", async () => {
  const r = await api(`/api/articles/${draftArticleId}`, {}, token);
  if (r.article.status !== "published") throw new Error(`status ${r.article.status}`);
  const md = await fetch(`${base}/api/articles/${draftArticleId}/markdown`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((x) => x.text());
  if (!md.startsWith("# ")) throw new Error("markdown export broken");
  return `${r.article.kb} · ${md.split("\n")[0].slice(2, 50)}`;
});

await step("deflection suggests the new article", async () => {
  for (let i = 0; i < 15; i++) {
    const r = await api(
      "/api/deflect",
      { method: "POST", body: JSON.stringify({ text: "VPN keeps asking for password after update" }) },
      token,
    );
    const hit = r.suggestions.find((s) => s.kind === "article" && s.id === draftArticleId);
    if (hit) return hit.title.slice(0, 50);
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("article not suggested after 15s");
});

await step("requester confirms the fix", async () => {
  const r = await api(`/api/requests/${requestId}/confirm`, { method: "POST", body: JSON.stringify({ fixed: true }) }, token);
  if (r.request.status !== "solved") throw new Error("not solved");
});

await step("article feedback", async () => {
  await api(`/api/articles/${draftArticleId}/feedback`, { method: "POST", body: JSON.stringify({ helpful: true }) }, token);
});

await step("global search finds article + request", async () => {
  const r = await api(`/api/search?q=${encodeURIComponent("VPN password")}`, {}, token);
  if (r.articles.length === 0) throw new Error("no articles in search");
  return `${r.articles.length} articles, ${r.requests.length} requests`;
});

// --- read-only surfaces the web app depends on ---

await step("insights (admin dashboard)", async () => {
  const r = await api("/api/insights?days=30", {}, token);
  if (typeof r.deflection?.rate !== "number") throw new Error("bad insights payload");
  return `deflection ${Math.round(r.deflection.rate * 100)}%`;
});

await step("gaps & health", async () => {
  const r = await api("/api/insights/gaps", {}, token);
  if (!Array.isArray(r.gaps) || !Array.isArray(r.staleArticles)) throw new Error("bad gaps payload");
  return `${r.gaps.length} gaps, ${r.staleArticles.length} stale`;
});

await step("notifications list", async () => {
  const r = await api("/api/notifications", {}, token);
  if (!Array.isArray(r.notifications)) throw new Error("bad notifications payload");
  return `${r.notifications.length} items, ${r.unread} unread`;
});

await step("org users (admin)", async () => {
  const r = await api("/api/org/users", {}, token);
  if (!Array.isArray(r.users) || r.users.length === 0) throw new Error("no users");
  return `${r.users.length} users`;
});

await step("integration channels", async () => {
  const r = await api("/api/integrations/channels", {}, token);
  if (!r.api?.discoveryUrl) throw new Error("bad channels payload");
});

await step("review counts", async () => {
  const r = await api("/api/reviews/counts", {}, token);
  if (typeof r.counts?.total !== "number") throw new Error("bad counts payload");
  return `${r.counts.total} pending`;
});

console.log(`\nkloop smoke @ ${base}\n`);
console.log(results.join("\n"));
console.log(failures === 0 ? "\nAll smoke checks passed.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
