import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { isSupporter as roleIsSupporter, useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { Button, Chip, ErrorState, SectionLabel, Sheet, Spinner } from "../../ui";
import { BackBar } from "../shared/BackBar";
import { AttachmentPreview } from "../thread/Thread";
import { ArticleBlocks } from "./ArticleBlocks";

export function ArticlePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const supporter = roleIsSupporter(user);
  const [feedback, setFeedback] = useState<null | boolean>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["article", id],
    queryFn: () => api.article(id!),
    enabled: !!id,
  });

  // tombstone → follow the merge redirect
  useEffect(() => {
    if (data?.redirectTo) navigate(`/kb/${data.redirectTo}`, { replace: true });
  }, [data?.redirectTo, navigate]);

  const archive = useMutation({
    mutationFn: () => api.archiveArticle(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["articles"] });
      navigate("/kb");
    },
  });

  if (error && !data) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
  if (isLoading || !data || data.redirectTo) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }

  const { article, blocks, provenance } = data;
  const total = article.helpfulCount + article.notHelpfulCount;
  const helpfulPct = total > 0 ? Math.round((article.helpfulCount / total) * 100) : null;

  const sendFeedback = (helpful: boolean) => {
    setFeedback(helpful);
    void api.articleFeedback(id!, helpful).catch(() => {});
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-4">
      <BackBar
        title={article.kb}
        subtitle={`Updated ${timeAgo(article.updatedAt)} ago${helpfulPct != null ? ` · ${helpfulPct}% found this helpful` : ""}`}
        right={
          supporter ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => navigate(`/kb/${id}/edit`)}>
                Edit
              </Button>
            </div>
          ) : undefined
        }
      />

      {supporter && article.staleFlag && (
        <div className="mt-3 rounded-inner bg-amber-soft px-4 py-2.5 text-[13px] font-medium text-amber">
          Flagged stale{article.staleReason ? ` — ${article.staleReason}` : ""}. Recent resolutions may contradict this article.
        </div>
      )}

      <h1 className="mt-4 text-[24px] font-bold leading-tight tracking-tight">{article.title}</h1>
      {article.summary && <p className="mt-1.5 text-[14px] text-ink-secondary">{article.summary}</p>}

      {article.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {article.tags.map((tg) => (
            <span key={tg} className="rounded-full bg-chip px-2.5 py-1 text-[12px] font-medium text-ink-secondary">
              {tg}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4">
        <ArticleBlocks blocks={blocks} provenance={supporter ? provenance : undefined} />
      </div>

      {(data.attachments?.length ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.attachments!.map((a) => (
            <AttachmentPreview key={a.id} a={a} />
          ))}
        </div>
      )}

      {(data.related?.length ?? 0) > 0 && (
        <div className="mt-6">
          <SectionLabel>See also</SectionLabel>
          <div className="mt-2 flex flex-col gap-1.5">
            {data.related!.map((r) => (
              <button
                key={r.id}
                onClick={() => navigate(`/kb/${r.id}`)}
                className="glass flex items-center gap-2.5 rounded-inner px-3.5 py-2.5 text-left text-[14px] font-medium text-ink cursor-pointer"
              >
                <span className="text-[12px] font-semibold text-ink-faint">{r.kb}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2.5 text-[14px] text-ink-secondary">
        {t("answer.wasHelpful")}
        <Chip onClick={() => sendFeedback(true)} active={feedback === true} className="bg-card shadow-card">
          Yes
        </Chip>
        <Chip onClick={() => sendFeedback(false)} active={feedback === false} className="bg-card shadow-card">
          No
        </Chip>
      </div>

      {supporter && (
        <div className="mt-8 rounded-card bg-surface p-4">
          <SectionLabel>Manage</SectionLabel>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
            <span>
              confidence {Math.round(article.confidence * 100)}% · freshness {Math.round(article.freshnessScore * 100)}% ·{" "}
              {article.viewCount} views · {article.solveCount} solves
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            <a href={`/api/articles/${id}/markdown`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary">Export markdown</Button>
            </a>
            <Button size="sm" variant="danger" onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          </div>
        </div>
      )}

      <Sheet open={archiveOpen} onClose={() => setArchiveOpen(false)} title="Archive this article?">
        <p className="text-[14px] text-ink-secondary">
          It disappears from the KB and deflection. Existing links keep working and can redirect if you later merge it.
        </p>
        <div className="mt-5 flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={() => setArchiveOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" className="flex-1 !bg-danger !text-white" loading={archive.isPending} onClick={() => archive.mutate()}>
            Archive
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
