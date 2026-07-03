import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RequestSummary } from "@kloop/shared";
import { api } from "../../lib/api";
import { sentLabel, dateLabel } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Card, EmptyState, SectionLabel, Spinner, StatusBadge } from "../../ui";

export function MyRequestsPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({ queryKey: ["requests", "mine"], queryFn: () => api.requests() });

  const open = (data?.requests ?? []).filter((r) => r.status !== "solved");
  const solved = (data?.requests ?? []).filter((r) => r.status === "solved");

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("nav.myRequests")} />
      {isLoading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : data && open.length === 0 && solved.length === 0 ? (
        <EmptyState title="Nothing here yet" hint="When you ask for help, your requests and their status will show up here." />
      ) : (
        <>
          {open.length > 0 && (
            <>
              <SectionLabel className="mb-2.5 px-1">Open</SectionLabel>
              <div className="mb-7 flex flex-col gap-2.5">
                {open.map((r) => (
                  <RequestRow key={r.id} r={r} />
                ))}
              </div>
            </>
          )}
          {solved.length > 0 && (
            <>
              <SectionLabel className="mb-2.5 px-1">Solved</SectionLabel>
              <div className="flex flex-col gap-2.5">
                {solved.map((r) => (
                  <RequestRow key={r.id} r={r} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function RequestRow({ r }: { r: RequestSummary }) {
  const navigate = useNavigate();
  const sub = subline(r);
  return (
    <Card as="button" onClick={() => navigate(`/requests/${r.id}`)} className="flex items-center gap-3 p-4">
      <span className="min-w-0 flex-1">
        <span className={`block leading-snug ${r.unreadForRequester ? "font-bold" : "font-semibold"} text-ink`}>{r.title}</span>
        <span className="mt-0.5 block text-[13px] text-ink-secondary">{sub}</span>
      </span>
      <StatusBadge status={r.status} />
    </Card>
  );
}

function subline(r: RequestSummary): string {
  if (r.status === "solved") {
    if (r.selfSolvedArticleId) return `Self-solved ${dateLabel(r.solvedAt)} · from suggested article`;
    if (r.confirmationState === "confirmed") return `Solved ${dateLabel(r.solvedAt)} · you confirmed the fix`;
    return `Solved ${dateLabel(r.solvedAt)}`;
  }
  const base = `Sent ${sentLabel(r.createdAt)}`;
  if (r.unreadForRequester) return `${base} · new reply`;
  return base;
}
