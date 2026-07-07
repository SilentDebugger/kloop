import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RequestSummary } from "@kloop/shared";
import { api } from "../../lib/api";
import { dateLabel, timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Card, Divider, EmptyState, ErrorState, GroupedCard, PastRow, ReplyPreview, SectionLabel, Spinner, StatusLine } from "../../ui";

export function MyRequestsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["requests", "mine"], queryFn: () => api.requests() });

  const open = (data?.requests ?? []).filter((r) => r.status !== "solved");
  const solved = (data?.requests ?? []).filter((r) => r.status === "solved");
  const waiting = open.filter((r) => r.unreadForRequester).length;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("nav.myRequests")} />
      {open.length > 0 && (
        <p className="-mt-4 mb-6 text-[14px] text-ink-secondary">
          {open.length} open
          {waiting > 0 ? ` · ${waiting} repl${waiting > 1 ? "ies" : "y"} waiting for you` : ""}
        </p>
      )}
      {error && !data ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : data && open.length === 0 && solved.length === 0 ? (
        <EmptyState title="Nothing here yet" hint="When you ask for help, your requests and their status will show up here." />
      ) : (
        <>
          {open.length > 0 && (
            <div className="mb-7 flex flex-col gap-2.5">
              {open.map((r) => (
                <OpenCard key={r.id} r={r} />
              ))}
            </div>
          )}
          {solved.length > 0 && (
            <>
              <SectionLabel className="mb-2.5 px-1">Past</SectionLabel>
              <GroupedCard>
                {solved.map((r, i) => (
                  <div key={r.id}>
                    {i > 0 && <Divider />}
                    <PastRow
                      title={r.title}
                      subtitle={r.selfSolvedArticleId ? `Self-solved ${dateLabel(r.solvedAt)}` : `Solved ${dateLabel(r.solvedAt)}`}
                      onClick={() => navigate(`/requests/${r.id}`)}
                    />
                  </div>
                ))}
              </GroupedCard>
            </>
          )}
        </>
      )}
    </div>
  );
}

function OpenCard({ r }: { r: RequestSummary }) {
  const navigate = useNavigate();
  const meta = r.status === "handled" ? `updated ${timeAgo(r.lastActivityAt)} ago` : "waiting for a supporter";
  return (
    <Card as="button" onClick={() => navigate(`/requests/${r.id}`)} className="p-4">
      <StatusLine status={r.status === "handled" ? "handled" : "open"} meta={meta} />
      <span className="mt-1.5 block text-[16px] font-extrabold leading-snug text-ink">{r.title}</span>
      {r.lastMessage && (
        <ReplyPreview
          name={r.lastMessage.fromAi ? "kloop" : (r.lastMessage.authorName ?? "Reply")}
          body={r.lastMessage.body}
          unread={r.unreadForRequester}
        />
      )}
    </Card>
  );
}
