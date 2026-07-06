import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RequestSummary } from "@kloop/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Card, Chip, EmptyState, ErrorState, SectionLabel, Spinner, StatusBadge } from "../../ui";

/** The requester a row belongs to (guests count too) — used for the person filter. */
function requesterName(r: RequestSummary): string | null {
  return r.author?.name ?? (r.guestName ? `${r.guestName} (guest)` : null);
}

/** My work — everything I've claimed, waiting on confirmation, recently solved. Filterable by person. */
export function MyWorkPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const [person, setPerson] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["requests", "my-work"],
    queryFn: () => api.requests({ view: "queue" }),
  });

  const mine = (data?.requests ?? []).filter((r) => r.claimedBy === user?.id);
  const people = [...new Set(mine.map(requesterName).filter(Boolean) as string[])].sort();
  const shown = person ? mine.filter((r) => requesterName(r) === person) : mine;
  const active = shown.filter((r) => r.status !== "solved" && r.confirmationState !== "pending");
  const waiting = shown.filter((r) => r.confirmationState === "pending");
  const solved = shown.filter((r) => r.status === "solved").slice(0, 15);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("nav.myWork")} />
      {people.length > 1 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {people.map((p) => (
            <Chip key={p} active={person === p} onClick={() => setPerson(person === p ? null : p)}>
              {p}
            </Chip>
          ))}
        </div>
      )}
      {error && !data ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : mine.length === 0 ? (
        <EmptyState title="Nothing claimed yet" hint="Claim requests from the queue and they'll show up here." />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing for this person" hint="They have no requests in your claimed work." />
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
                {r.ref} · {requesterName(r) ?? ""} · {timeAgo(r.lastActivityAt)} ago
              </span>
            </span>
            <StatusBadge status={r.status} />
          </Card>
        ))}
      </div>
    </section>
  );
}
