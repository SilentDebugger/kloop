import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { PageHeader } from "../../shell/AppShell";
import { Card, SectionLabel, Segmented, Spinner } from "../../ui";

/** Admin insights: deflection, coverage, recurring issues, time saved. */
export function InsightsPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const { data, isLoading } = useQuery({
    queryKey: ["insights", days],
    queryFn: () => api.insights(Number(days)),
  });

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
      <Card className="mt-5 mb-8 p-5">
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
    </div>
  );
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
