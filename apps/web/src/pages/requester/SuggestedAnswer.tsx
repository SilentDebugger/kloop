import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useDrafts } from "../../lib/drafts";
import { ArticleBlocks } from "../kb/ArticleBlocks";
import { BackBar } from "../shared/BackBar";
import { Button, Chip, ErrorState, Spinner } from "../../ui";

/**
 * "Suggested answer" — shown when a deflection suggestion is tapped.
 * Bottom bar: "This solved it" (self-solve, counted as deflection) or
 * "Still need help — send my request".
 */
export function SuggestedAnswerPage() {
  const { t } = useTranslation();
  const { articleId } = useParams<{ articleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const draftTitle: string = (location.state as { draftTitle?: string } | null)?.draftTitle ?? "";
  const { setComposerText } = useDrafts();
  const [feedback, setFeedback] = useState<null | boolean>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["article", articleId],
    queryFn: () => api.article(articleId!),
    enabled: !!articleId,
  });

  const solved = useMutation({
    mutationFn: () =>
      api.selfSolve({ title: draftTitle || `Self-solved via ${data?.article.kb}`, articleId: articleId! }),
    onSuccess: (res) => {
      setComposerText("");
      navigate(`/requests/${res.request.id}`, { replace: true });
    },
  });

  const escalate = useMutation({
    mutationFn: () => api.createRequest({ title: draftTitle, channel: "web" }),
    onSuccess: (res) => {
      setComposerText("");
      navigate(`/requests/${res.request.id}`, { replace: true });
    },
  });

  const sendFeedback = (helpful: boolean) => {
    setFeedback(helpful);
    void api.articleFeedback(articleId!, helpful).catch(() => {});
  };

  if (error && !data) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }

  const { article, blocks } = data;
  const helpfulTotal = article.helpfulCount + article.notHelpfulCount;
  const helpfulPct = helpfulTotal > 0 ? Math.round((article.helpfulCount / helpfulTotal) * 100) : null;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-40 pt-4">
      <BackBar title="Suggested answer" />

      <h1 className="mt-4 text-[24px] font-bold leading-tight tracking-tight">{article.title}</h1>
      <div className="mt-1.5 text-[13px] text-ink-secondary">
        {article.kb} · Updated {timeAgo(article.updatedAt)} ago
        {helpfulPct != null ? ` · ${helpfulPct}% found this helpful` : ""}
      </div>

      <div className="mt-4">
        <ArticleBlocks blocks={blocks} />
      </div>

      <div className="mt-5 flex items-center gap-2.5 text-[14px] text-ink-secondary">
        {t("answer.wasHelpful")}
        <Chip onClick={() => sendFeedback(true)} active={feedback === true} className="bg-card shadow-card">
          Yes
        </Chip>
        <Chip onClick={() => sendFeedback(false)} active={feedback === false} className="bg-card shadow-card">
          No
        </Chip>
      </div>

      {/* bottom action bar */}
      <div className="fixed inset-x-0 bottom-20 z-20 px-4 md:bottom-6 md:pl-64">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3">
          <Button size="lg" className="shadow-float" loading={solved.isPending} onClick={() => solved.mutate()}>
            {t("answer.solved")}
          </Button>
          {draftTitle && (
            <button
              className="rounded-full bg-bg/80 px-4 py-1 text-[14px] font-semibold text-ink backdrop-blur cursor-pointer"
              onClick={() => escalate.mutate()}
              disabled={escalate.isPending}
            >
              {t("answer.stillNeedHelp")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
