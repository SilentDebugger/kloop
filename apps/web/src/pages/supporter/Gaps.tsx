import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, EmptyState, ErrorState, SectionLabel, Spinner } from "../../ui";
import { IconSparkle } from "../../ui/icons";

/** Gaps & health — clusters without articles, and stale docs to refresh. */
export function GapsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["gaps"], queryFn: () => api.gaps() });

  if (error && !data) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }

  const { gaps, staleArticles } = data;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("nav.gaps")} />

      {gaps.length === 0 && staleArticles.length === 0 && (
        <EmptyState
          icon={<IconSparkle size={30} className="text-ink-faint" />}
          title="No gaps detected"
          hint="When recurring requests have no matching article, they'll surface here."
        />
      )}

      {gaps.length > 0 && (
        <>
          <SectionLabel className="mb-2.5 px-1">Documentation gaps</SectionLabel>
          <div className="mb-7 flex flex-col gap-2.5">
            {gaps.map((g) => (
              <Card key={g.clusterId} className="p-4">
                <div className="font-bold leading-snug">{g.label ?? "Unlabeled topic"}</div>
                <div className="mt-0.5 text-[13px] text-ink-secondary">
                  {g.requestCount} requests · ~{Math.round(g.minutesSpent)} min spent
                  {g.lastRequestAt ? ` · last ${timeAgo(g.lastRequestAt)} ago` : ""}
                </div>
                {g.sampleTitles.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {g.sampleTitles.slice(0, 3).map((title, i) => (
                      <li key={i} className="truncate text-[13px] text-ink-secondary">
                        · "{title}"
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3">
                  <Button size="sm" variant="secondary" onClick={() => navigate("/kb/new")}>
                    Write the article
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {staleArticles.length > 0 && (
        <>
          <SectionLabel className="mb-2.5 px-1">Needs a refresh</SectionLabel>
          <div className="flex flex-col gap-2.5 pb-8">
            {staleArticles.map((a) => (
              <Card key={a.id} as="button" onClick={() => navigate(`/kb/${a.id}`)} className="flex items-center gap-3 p-4">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{a.title}</span>
                  <span className="mt-0.5 block text-[13px] text-ink-secondary">
                    {a.kb} · freshness {Math.round(a.freshnessScore * 100)}%{a.staleReason ? ` · ${a.staleReason}` : ""}
                  </span>
                </span>
                <span className="rounded-md bg-amber-soft px-2 py-0.5 text-[11px] font-bold uppercase text-amber">Stale</span>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
