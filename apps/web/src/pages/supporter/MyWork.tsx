import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RequestSummary } from "@kloop/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { dateLabel, timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Card, Chip, Divider, EmptyState, ErrorState, GroupedCard, PastRow, ReplyPreview, SectionLabel, Spinner, StatusLine } from "../../ui";

/** The requester a row belongs to (guests count too) — used for the person filter. */
function requesterName(r: RequestSummary): string | null {
  return r.author?.name ?? (r.guestName ? `${r.guestName} (guest)` : null);
}

/** My work — everything I've claimed, waiting on confirmation, recently solved. Filterable by person. */
export function MyWorkPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
          {active.length > 0 && <ActiveGroup label={`Handling · ${active.length}`} rows={active} />}
          {waiting.length > 0 && <ActiveGroup label={`Waiting for confirmation · ${waiting.length}`} rows={waiting} waitingOnConfirmation />}
          {solved.length > 0 && <PastGroup rows={solved} />}
        </div>
      )}
    </div>
  );
}

function ActiveGroup({ label, rows, waitingOnConfirmation }: { label: string; rows: RequestSummary[]; waitingOnConfirmation?: boolean }) {
  const navigate = useNavigate();
  return (
    <section>
      <SectionLabel className="mb-2.5 px-1">{label}</SectionLabel>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => {
          const meta = waitingOnConfirmation ? "awaiting confirmation" : `updated ${timeAgo(r.lastActivityAt)} ago`;
          return (
            <Card key={r.id} as="button" onClick={() => navigate(`/requests/${r.id}`)} className="p-4">
              <StatusLine status="handled" meta={meta} />
              <span className={`mt-1.5 block text-[16px] leading-snug text-ink ${r.unreadForSupporter ? "font-extrabold" : "font-bold"}`}>
                {r.title}
              </span>
              <span className="mt-0.5 block text-[13px] text-ink-secondary">
                {r.ref} · {requesterName(r) ?? ""}
              </span>
              {r.lastMessage && (
                <ReplyPreview
                  name={r.lastMessage.fromAi ? "kloop" : (r.lastMessage.authorName ?? "Reply")}
                  body={r.lastMessage.body}
                  unread={r.unreadForSupporter}
                />
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function PastGroup({ rows }: { rows: RequestSummary[] }) {
  const navigate = useNavigate();
  return (
    <section>
      <SectionLabel className="mb-2.5 px-1">Recently solved</SectionLabel>
      <GroupedCard>
        {rows.map((r, i) => (
          <div key={r.id}>
            {i > 0 && <Divider />}
            <PastRow
              title={r.title}
              subtitle={`Solved ${dateLabel(r.solvedAt)} · ${requesterName(r) ?? ""}`}
              onClick={() => navigate(`/requests/${r.id}`)}
            />
          </div>
        ))}
      </GroupedCard>
    </section>
  );
}
