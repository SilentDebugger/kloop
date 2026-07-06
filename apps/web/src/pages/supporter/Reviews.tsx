import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ReviewListItem } from "@kloop/shared";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, EmptyState, ErrorState, KindBadge, Segmented, Spinner } from "../../ui";

type Tab = "draft" | "update" | "merge";

/** Review inbox — drafts / updates / merges tabs; stale flags fold into updates. */
export function ReviewsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("draft");

  const { data: countsData } = useQuery({ queryKey: ["review-counts"], queryFn: () => api.reviewCounts() });
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["reviews", "list"], queryFn: () => api.reviews() });

  const counts = countsData?.counts;
  const items = data?.items ?? [];
  const byTab: Record<Tab, ReviewListItem[]> = {
    draft: items.filter((i) => i.kind === "draft"),
    update: items.filter((i) => i.kind === "update" || i.kind === "stale"),
    merge: items.filter((i) => i.kind === "merge"),
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("nav.reviews")} />

      <div className="mb-4">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "draft", label: `${t("reviews.drafts")} · ${counts?.draft ?? byTab.draft.length}` },
            { value: "update", label: `${t("reviews.updates")} · ${(counts ? counts.update + counts.stale : byTab.update.length)}` },
            { value: "merge", label: `${t("reviews.merges")} · ${counts?.merge ?? byTab.merge.length}` },
          ]}
        />
      </div>

      {error && !data ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : byTab[tab].length === 0 ? (
        <EmptyState
          title="Nothing to review"
          hint={
            tab === "draft"
              ? "When resolutions produce article drafts, they land here for approval."
              : tab === "update"
                ? "Contradictions and stale docs will queue update proposals here."
                : "When two articles drift together, a merge proposal appears here."
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5 pb-8">
          {byTab[tab].map((item) => (
            <ReviewCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ item }: { item: ReviewListItem }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const approve = useMutation({
    mutationFn: () => api.approveReview(item.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      void qc.invalidateQueries({ queryKey: ["review-counts"] });
      void qc.invalidateQueries({ queryKey: ["articles"] });
    },
  });
  const reject = useMutation({
    mutationFn: () => api.rejectReview(item.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      void qc.invalidateQueries({ queryKey: ["review-counts"] });
    },
  });

  const confidenceLabel =
    item.confidence >= 0.75 ? "high confidence" : item.confidence >= 0.45 ? "medium confidence" : "low confidence";
  const title = item.kind === "stale" ? `${item.kb} · ${item.title ?? "Article"}` : (item.title ?? "Untitled draft");

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <KindBadge kind={item.kind} />
        <span className="text-[13px] text-ink-secondary">
          {item.kind === "stale" ? (item.context ?? "flagged") : confidenceLabel}
        </span>
      </div>
      <button
        onClick={() => navigate(item.kind === "stale" && item.articleId ? `/kb/${item.articleId}` : `/reviews/${item.id}`)}
        className="mt-2 block w-full text-left cursor-pointer"
      >
        <div className="font-bold leading-snug text-ink">{title}</div>
        <div className="mt-0.5 text-[13px] text-ink-secondary">
          {item.kind === "stale" ? (item.staleReason ?? "Needs a look") : (item.context ?? "")}
          {item.context || item.kind === "stale" ? " · " : ""}
          {timeAgo(item.createdAt)} ago
        </div>
      </button>

      {item.kind === "draft" ? (
        <div className="mt-3.5 flex gap-2">
          <Button size="sm" className="flex-1" loading={approve.isPending} onClick={() => approve.mutate()}>
            {t("reviews.approve")}
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => navigate(`/reviews/${item.id}?edit=1`)}>
            {t("reviews.edit")}
          </Button>
          <Button size="sm" variant="danger" className="flex-1" loading={reject.isPending} onClick={() => reject.mutate()}>
            {t("reviews.reject")}
          </Button>
        </div>
      ) : item.kind === "stale" ? (
        <div className="mt-3.5 flex gap-2">
          <Button size="sm" variant="secondary" className="flex-[2]" onClick={() => navigate(`/kb/${item.articleId}`)}>
            Review article ›
          </Button>
          <Button size="sm" variant="outline" className="flex-1" loading={reject.isPending} onClick={() => reject.mutate()}>
            Looks fine
          </Button>
        </div>
      ) : (
        <div className="mt-3.5">
          <Button size="sm" variant="secondary" className="w-full" onClick={() => navigate(`/reviews/${item.id}`)}>
            {item.kind === "merge" ? "Review merge ›" : "Review update ›"}
          </Button>
        </div>
      )}
    </Card>
  );
}
