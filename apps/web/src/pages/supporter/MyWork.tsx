import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RequestSummary } from "@kloop/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Card, EmptyState, SectionLabel, Spinner, StatusBadge } from "../../ui";

/** My work — everything I've claimed, waiting on confirmation, recently solved. */
export function MyWorkPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const { data, isLoading } = useQuery({
    queryKey: ["requests", "my-work"],
    queryFn: () => api.requests({ view: "queue" }),
  });

  const mine = (data?.requests ?? []).filter((r) => r.claimedBy === user?.id);
  const active = mine.filter((r) => r.status !== "solved" && r.confirmationState !== "pending");
  const waiting = mine.filter((r) => r.confirmationState === "pending");
  const solved = mine.filter((r) => r.status === "solved").slice(0, 15);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("nav.myWork")} />
      {isLoading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : mine.length === 0 ? (
        <EmptyState title="Nothing claimed yet" hint="Claim requests from the queue and they'll show up here." />
      ) : (
        <div className="flex flex-col gap-7 pb-8">
          {active.length > 0 && <Group label={`Handling · ${active.length}`} rows={active} />}
          {waiting.length > 0 && <Group label={`Waiting for confirmation · ${waiting.length}`} rows={waiting} />}
          {solved.length > 0 && <Group label="Recently solved" rows={solved} />}
        </div>
      )}
    </div>
  );
}

function Group({ label, rows }: { label: string; rows: RequestSummary[] }) {
  const navigate = useNavigate();
  return (
    <section>
      <SectionLabel className="mb-2.5 px-1">{label}</SectionLabel>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <Card key={r.id} as="button" onClick={() => navigate(`/requests/${r.id}`)} className="flex items-center gap-3 p-4">
            <span className="min-w-0 flex-1">
              <span className={`block leading-snug ${r.unreadForSupporter ? "font-bold" : "font-semibold"}`}>{r.title}</span>
              <span className="mt-0.5 block text-[13px] text-ink-secondary">
                {r.ref} · {r.author?.name ?? ""} · {timeAgo(r.lastActivityAt)} ago
              </span>
            </span>
            <StatusBadge status={r.status} />
          </Card>
        ))}
      </div>
    </section>
  );
}
