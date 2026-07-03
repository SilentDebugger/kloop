import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ArticleListItem } from "@kloop/shared";
import { api } from "../../lib/api";
import { isSupporter as roleIsSupporter, useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, Chip, EmptyState, Input, Segmented, Spinner } from "../../ui";
import { IconChevron, IconPlus } from "../../ui/icons";

/**
 * KB browser (requester) / KB manager (supporter).
 * Supporters get status filters, stale flags, confidence, and "New article".
 */
export function KbBrowserPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const supporter = roleIsSupporter(user);

  const [tag, setTag] = useState<string | null>(null);
  const [status, setStatus] = useState<"published" | "draft" | "archived" | "all">("published");
  const [search, setSearch] = useState("");

  const params: Record<string, string> = {};
  if (tag) params.tag = tag;
  if (supporter && status !== "published") params.status = status;

  const { data, isLoading } = useQuery({
    queryKey: ["articles", params],
    queryFn: () => api.articles(params),
  });

  const needle = search.trim().toLowerCase();
  const articles = (data?.articles ?? []).filter(
    (a) => !needle || a.title.toLowerCase().includes(needle) || a.summary.toLowerCase().includes(needle) || a.kb.toLowerCase().includes(needle),
  );

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader
        title={t("nav.knowledgeBase")}
        right={
          supporter ? (
            <Button size="sm" variant="secondary" onClick={() => navigate("/kb/new")}>
              <IconPlus size={15} /> New
            </Button>
          ) : undefined
        }
      />

      <Input placeholder="Search articles…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 shadow-card !border-transparent" />

      {supporter && (
        <div className="mb-3">
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: "published", label: "Published" },
              { value: "draft", label: "Drafts" },
              { value: "archived", label: "Archived" },
              { value: "all", label: "All" },
            ]}
          />
        </div>
      )}

      {(data?.tags?.length ?? 0) > 0 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {(data!.tags as { tag: string; n: number }[]).slice(0, 12).map((tg) => (
            <Chip key={tg.tag} active={tag === tg.tag} onClick={() => setTag(tag === tg.tag ? null : tg.tag)}>
              {tg.tag}
            </Chip>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : articles.length === 0 ? (
        <EmptyState title="No articles yet" hint="Solved requests become articles here — automatically drafted, human approved." />
      ) : (
        <div className="flex flex-col gap-2.5 pb-8">
          {articles.map((a) => (
            <ArticleRow key={a.id} a={a} supporter={supporter} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleRow({ a, supporter }: { a: ArticleListItem; supporter: boolean }) {
  const navigate = useNavigate();
  const total = a.helpfulCount + a.notHelpfulCount;
  const helpful = total > 0 ? `${Math.round((a.helpfulCount / total) * 100)}% found this helpful` : null;

  return (
    <Card as="button" onClick={() => navigate(`/kb/${a.id}`)} className="flex items-center gap-3 p-4">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug text-ink">{a.title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-ink-secondary">
          {a.kb} · Updated {timeAgo(a.updatedAt)} ago{helpful ? ` · ${helpful}` : ""}
        </span>
        {supporter && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {a.status !== "published" && (
              <span className="rounded-md bg-chip px-2 py-0.5 text-[11px] font-bold uppercase text-ink-secondary">{a.status}</span>
            )}
            {a.staleFlag && (
              <span className="rounded-md bg-amber-soft px-2 py-0.5 text-[11px] font-bold uppercase text-amber">Stale</span>
            )}
            <span className="text-[11px] text-ink-faint">
              confidence {Math.round(a.confidence * 100)}% · {a.solveCount} solves
            </span>
          </span>
        )}
      </span>
      <IconChevron size={16} className="shrink-0 text-ink-faint" />
    </Card>
  );
}
