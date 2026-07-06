import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { PageHeader } from "../../shell/AppShell";
import { Card, ErrorState, SectionLabel, Segmented, Spinner } from "../../ui";

/** Admin insights: deflection, coverage, recurring issues, time saved. */
export function InsightsPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["insights", days],
    queryFn: () => api.insights(Number(days)),
  });

  if (error && !data) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }

  const maxWeek = Math.max(1, ...data.trend.map((w) => w.requests));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("nav.insights")} />

      <div className="mb-5">
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
        />
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Deflection rate" value={`${Math.round(data.deflection.rate * 100)}%`} sub={`${data.deflection.selfSolved} self-solved · ${data.deflection.autoAnswered} auto`} />
        <Stat label="Time saved" value={`${data.deflection.timeSavedHours}h`} sub={`~${data.requests.avgSolveMinutes} min avg solve`} />
        <Stat label="Requests" value={String(data.requests.total)} sub={`${data.requests.solved} solved · ${data.requests.escalated} escalated`} />
        <Stat label="Coverage" value={`${Math.round(data.knowledge.clusterCoverage * 100)}%`} sub={`${data.knowledge.published} published · ${data.knowledge.stale} stale`} />
      </div>

      {/* trend */}
      {data.trend.length > 0 && (
        <Card className="mt-5 p-5">
          <SectionLabel>Requests vs deflected · weekly</SectionLabel>
          <div className="mt-4 flex h-36 items-end gap-2">
            {data.trend.map((w) => (
              <div key={String(w.week)} className="group relative flex flex-1 flex-col items-center justify-end gap-0.5">
                <div className="flex w-full max-w-10 flex-col justify-end gap-0.5" style={{ height: "100%" }}>
                  <div
                    className="w-full rounded-t-md bg-mint-strong transition-all"
                    style={{ height: `${(w.requests / maxWeek) * 100}%`, minHeight: w.requests > 0 ? 4 : 0 }}
                  />
                  <div
                    className="w-full rounded-t-md bg-primary"
                    style={{ height: `${(w.deflected / maxWeek) * 100}%`, minHeight: w.deflected > 0 ? 4 : 0 }}
                  />
                </div>
                <span className="text-[10px] text-ink-faint">
                  {new Date(String(w.week)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
                <span className="pointer-events-none absolute -top-6 hidden rounded-md bg-ink px-2 py-0.5 text-[11px] text-white group-hover:block">
                  {w.requests} req · {w.deflected} deflected
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-[12px] text-ink-secondary">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-mint-strong" /> requests
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> deflected
            </span>
          </div>
        </Card>
      )}

      {/* recurring issues */}
      <Card className="mt-5 p-5">
        <SectionLabel>Recurring issues</SectionLabel>
        {data.recurringIssues.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-secondary">No recurring clusters in this window yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {data.recurringIssues.map((r) => {
              const max = Math.max(...data.recurringIssues.map((x) => x.recentRequests), 1);
              return (
                <div key={r.clusterId} className="flex items-center gap-3">
                  <span className="w-40 truncate text-[13px] font-medium sm:w-56">{r.label ?? "Unlabeled"}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-chip">
                    <div
                      className={`h-full rounded-full ${r.covered ? "bg-mint-strong" : "bg-amber-soft"}`}
                      style={{ width: `${(r.recentRequests / max) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-[13px] font-semibold">{r.recentRequests}</span>
                  <span
                    className={`w-20 rounded-md px-1.5 py-0.5 text-center text-[10px] font-bold uppercase ${
                      r.covered ? "bg-mint text-primary" : "bg-amber-soft text-amber"
                    }`}
                  >
                    {r.covered ? "covered" : "gap"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* AI cost analytics */}
      <div className="mt-8">
        <h2 className="text-[17px] font-bold tracking-tight">AI costs</h2>
        <p className="mt-0.5 text-[13px] text-ink-secondary">
          Metered from provider-reported token usage — every API call is recorded with its exact billed tokens.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="AI spend"
          value={fmtUsd(data.ai.totalCostUsd)}
          sub={`${data.ai.calls} API calls${data.ai.estimatedCalls > 0 ? ` · ${data.ai.estimatedCalls} estimated` : ""}`}
        />
        <Stat
          label="Cache savings"
          value={fmtUsd(data.ai.cacheSavingsUsd)}
          sub={`${fmtTokens(data.ai.tokens.cached)} cached tokens`}
        />
        <Stat
          label="Input tokens"
          value={fmtTokens(data.ai.tokens.input)}
          sub={
            data.ai.tokens.input > 0
              ? `${Math.round((data.ai.tokens.cached / data.ai.tokens.input) * 100)}% from cache`
              : "no usage yet"
          }
        />
        <Stat label="Output tokens" value={fmtTokens(data.ai.tokens.output)} sub={`${fmtTokens(data.ai.tokens.media)} media tokens`} />
      </div>

      {/* daily spend */}
      {data.ai.byDay.length > 0 && (
        <Card className="mt-5 p-5">
          <SectionLabel>Spend per day</SectionLabel>
          <div className="mt-4 flex h-28 items-end gap-1">
            {data.ai.byDay.map((d) => {
              const maxDay = Math.max(...data.ai.byDay.map((x) => x.costUsd), 1e-9);
              return (
                <div key={String(d.day)} className="group relative flex flex-1 flex-col items-center justify-end">
                  <div
                    className="w-full max-w-8 rounded-t-md bg-primary transition-all"
                    style={{ height: `${(d.costUsd / maxDay) * 100}%`, minHeight: d.costUsd > 0 ? 4 : 1 }}
                  />
                  <span className="mt-1 text-[10px] text-ink-faint">
                    {new Date(String(d.day)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  <span className="pointer-events-none absolute -top-6 z-10 hidden whitespace-nowrap rounded-md bg-ink px-2 py-0.5 text-[11px] text-white group-hover:block">
                    {fmtUsd(d.costUsd)} · {d.calls} calls
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* by model */}
      <Card className="mt-5 p-5">
        <SectionLabel>Cost by model</SectionLabel>
        {data.ai.byModel.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-secondary">No AI usage in this window yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                  <th className="pb-2 pr-3">Model</th>
                  <th className="pb-2 pr-3 text-right">Calls</th>
                  <th className="pb-2 pr-3 text-right">Input</th>
                  <th className="pb-2 pr-3 text-right">Cached</th>
                  <th className="pb-2 pr-3 text-right">Output</th>
                  <th className="pb-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.ai.byModel.map((m) => (
                  <tr key={`${m.provider}/${m.model}`} className="border-t border-line">
                    <td className="py-2 pr-3">
                      <span className="font-semibold">{m.model}</span>
                      <span className="ml-1.5 text-[11px] text-ink-faint">{m.provider}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.calls}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {m.mediaSeconds > 0 ? `${(m.mediaSeconds / 60).toFixed(1)} min` : fmtTokens(m.inputTokens + m.mediaTokens)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtTokens(m.cachedTokens)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtTokens(m.outputTokens)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{fmtUsd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* by purpose */}
      <Card className="mt-5 mb-8 p-5">
        <SectionLabel>Cost by purpose</SectionLabel>
        {data.ai.byPurpose.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-secondary">No AI usage in this window yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {data.ai.byPurpose.map((p) => {
              const max = Math.max(...data.ai.byPurpose.map((x) => x.costUsd), 1e-9);
              return (
                <div key={p.purpose} className="flex items-center gap-3">
                  <span className="w-40 truncate text-[13px] font-medium sm:w-56">{purposeLabel(p.purpose)}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-chip">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(p.costUsd / max) * 100}%` }} />
                  </div>
                  <span className="w-16 text-right text-[12px] tabular-nums text-ink-secondary">{p.calls} calls</span>
                  <span className="w-16 text-right text-[13px] font-semibold tabular-nums">{fmtUsd(p.costUsd)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function fmtUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const PURPOSE_LABELS: Record<string, string> = {
  reply_draft: "Reply drafts",
  article_draft: "Article drafts",
  structure_capture: "Resolution structuring",
  auto_answer: "Auto-answers",
  merge_proposal: "Merge proposals",
  update_proposal: "Update proposals",
  cluster_label: "Cluster labels",
  search_query: "Search queries",
  deflection: "Deflection matching",
  embed_request: "Request embeddings",
  embed_resolution: "Resolution embeddings",
  embed_article: "Article embeddings",
  embed_message: "Message embeddings",
  embed_attachment: "Attachment processing",
  seed: "Demo data seed",
  healthcheck: "Healthchecks",
  other: "Other",
};

function purposeLabel(key: string): string {
  return PURPOSE_LABELS[key] ?? key;
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-1 text-[26px] font-bold tracking-tight text-primary">{value}</div>
      <div className="text-[12px] text-ink-secondary">{sub}</div>
    </Card>
  );
}
