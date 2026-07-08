import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ArticleListItem } from "@kloop/shared";
import { api } from "../../lib/api";
import { isSupporter as roleIsSupporter, useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, Chip, EmptyState, ErrorState, Input, Segmented, Spinner } from "../../ui";
import { MediaQueryBar, useComposerAttachments } from "../../ui/attachments";
import { IconChevron, IconPlus, IconSparkle } from "../../ui/icons";
import { NewDocSheet } from "./NewDocSheet";

/**
 * KB browser (requester) / KB manager (supporter). Typing (or attaching a
 * photo / voice memo) switches to hybrid semantic search over the same docs.
 * Supporters get status filters, stale flags, confidence, and "New article".
 */
export function KbBrowserPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const supporter = roleIsSupporter(user);

  const [tag, setTag] = useState<string | null>(null);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [status, setStatus] = useState<"published" | "draft" | "archived" | "all">("published");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const att = useComposerAttachments();

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const searching = q.length >= 2 || att.ids.length > 0;

  const params: Record<string, string> = {};
  if (tag) params.tag = tag;
  if (supporter && status !== "published") params.status = status;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["articles", params],
    queryFn: () => api.articles(params),
  });
  const { data: found, isFetching: searchLoading } = useQuery({
    queryKey: ["search", q, att.ids.join(",")],
    queryFn: () => api.search(q, att.ids),
    enabled: searching,
    staleTime: 30_000,
    refetchInterval: (query) => ((query.state.data?.pendingAttachments ?? 0) > 0 ? 3000 : false),
  });

  const articles = data?.articles ?? [];
  const loading = searching ? searchLoading || att.uploading || (found?.pendingAttachments ?? 0) > 0 : isLoading;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader
        title={t("nav.knowledgeBase")}
        right={
          supporter ? (
            <span className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => navigate("/kb/new")}>
                <IconPlus size={15} /> New
              </Button>
              <Button size="sm" onClick={() => setNewDocOpen(true)}>
                <IconSparkle size={15} /> New doc
              </Button>
            </span>
          ) : undefined
        }
      />
      {supporter && <NewDocSheet open={newDocOpen} onClose={() => setNewDocOpen(false)} />}

      <Input placeholder="Search articles — text, photo, or voice…" value={search} onChange={(e) => setSearch(e.target.value)} className="shadow-card !border-transparent" />
      <div className="mb-3">
        <MediaQueryBar att={att} />
      </div>

      {supporter && !searching && (
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

      {!searching && (data?.tags?.length ?? 0) > 0 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {(data!.tags as { tag: string; n: number }[]).slice(0, 12).map((tg) => (
            <Chip key={tg.tag} active={tag === tg.tag} onClick={() => setTag(tag === tg.tag ? null : tg.tag)}>
              {tg.tag}
            </Chip>
          ))}
        </div>
      )}

      {!searching && error && !data ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : loading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : searching ? (
        (found?.articles.length ?? 0) === 0 ? (
          <EmptyState title="No matches" hint="Try different words — search also matches by meaning." />
        ) : (
          <div className="flex flex-col gap-2.5 pb-8">
            {found!.articles.map((a) => (
              <Card key={a.id} as="button" onClick={() => navigate(`/kb/${a.id}`)} className="flex items-center gap-3 p-4">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug text-ink">{a.title}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-secondary">
                    {a.kb}
                    {a.summary ? ` · ${a.summary}` : ""}
                  </span>
                </span>
                <IconChevron size={16} className="shrink-0 text-ink-faint" />
              </Card>
            ))}
          </div>
        )
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
