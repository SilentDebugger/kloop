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

console.log(`\nkloop smoke @ ${base}\n`);
console.log(results.join("\n"));
console.log(failures === 0 ? "\nAll smoke checks passed.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
