import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { Markdown } from "../../lib/markdown";
import { Button, ErrorNote, ErrorState, Input, SectionLabel, Spinner } from "../../ui";
import { BackBar } from "../shared/BackBar";

type BlockShape = { id?: string; kind: string; conditionText: string | null; contentMd: string; position?: number };
type DraftPayload = {
  item: { id: string; kind: "draft" | "update" | "stale"; confidence: number; context: string | null; createdAt: string };
  article: { id: string; kb: string; status: string; staleReason: string | null };
  proposed: { revisionId: string; title: string; summary: string; changeNote: string | null; blocks: BlockShape[] };
  current: { title: string; blocks: BlockShape[] } | null;
  sources: string[];
  similarArticles?: { id: string; kb: string; title: string; summary: string; similarity: number | null }[];
};
type MergePayload = {
  item: { id: string; kind: "merge"; confidence: number; context: string | null };
  mergeCandidate: {
    id: string;
    verdict: string | null;
    scores: Record<string, number> | null;
    compositeScore: number;
    proposal: {
      mergedTitle: string;
      mergedSummary: string;
      blocks: { kind: string; conditionText?: string | null; contentMd: string; origin?: string }[];
      diff: { op: string; blockKind: string; text: string; from?: string }[];
      rationale: string;
      confidence: number;
    } | null;
  };
  articleA: { id: string; kb: string; title: string; summary: string; blocks: BlockShape[] } | null;
  articleB: { id: string; kb: string; title: string; summary: string; blocks: BlockShape[] } | null;
};

const kindLabels: Record<string, string> = {
  symptoms: "Symptoms",
  environment: "Environment",
  resolution: "Resolution steps",
  notes: "Notes",
};

export function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["reviews", "detail", id],
    queryFn: () => api.review(id!),
    enabled: !!id,
  });

  if (error && !data) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }
  const payload = data as unknown as DraftPayload | MergePayload;
  return payload.item.kind === "merge" ? (
    <MergeReview payload={payload as MergePayload} />
  ) : (
    <DraftReview payload={payload as DraftPayload} />
  );
}

/* ===================================================================== */
/* Draft / update review — sources, blocks, edit-then-approve            */
/* ===================================================================== */

function DraftReview({ payload }: { payload: DraftPayload }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { item, article, proposed, current, sources } = payload;

  const [editing, setEditing] = useState(params.get("edit") === "1");
  const [title, setTitle] = useState(proposed.title);
  const [summary, setSummary] = useState(proposed.summary);
  const [blocks, setBlocks] = useState(
    proposed.blocks.map((b) => ({ kind: b.kind, conditionText: b.conditionText ?? "", contentMd: b.contentMd })),
  );
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    setTitle(proposed.title);
    setSummary(proposed.summary);
    setBlocks(proposed.blocks.map((b) => ({ kind: b.kind, conditionText: b.conditionText ?? "", contentMd: b.contentMd })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposed.revisionId]);

  const done = () => {
    void qc.invalidateQueries({ queryKey: ["reviews"] });
    void qc.invalidateQueries({ queryKey: ["review-counts"] });
    void qc.invalidateQueries({ queryKey: ["articles"] });
    navigate("/reviews", { replace: true });
  };

  const approve = useMutation({
    mutationFn: () =>
      api.approveReview(
        item.id,
        edited
          ? {
              title: title.trim(),
              summary: summary.trim(),
              blocks: blocks
                .filter((b) => b.contentMd.trim())
                .map((b) => ({ kind: b.kind, contentMd: b.contentMd.trim(), conditionText: b.conditionText.trim() || null })),
            }
          : undefined,
      ),
    onSuccess: done,
  });
  const reject = useMutation({ mutationFn: () => api.rejectReview(item.id), onSuccess: done });
  const merge = useMutation({ mutationFn: (articleId: string) => api.reviewMergeInto(item.id, articleId), onSuccess: done });
  const similar = payload.similarArticles ?? [];

  const confidenceLabel = item.confidence >= 0.75 ? "high confidence" : item.confidence >= 0.45 ? "medium confidence" : "low confidence";

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-36 pt-4">
      <BackBar
        title={`${item.kind === "draft" ? "Draft" : "Update"} · ${article.kb}`}
        subtitle={`Generated · ${confidenceLabel}${item.context ? ` · ${item.context}` : ""}`}
        right={
          <button className="text-[14px] font-semibold text-primary cursor-pointer" onClick={() => { setEditing((e) => !e); setEdited(true); }}>
            {editing ? "Preview" : t("reviews.edit")}
          </button>
        }
      />

      {sources.length > 0 && (
        <div className="mt-4 rounded-card bg-mint p-4">
          <SectionLabel className="!text-primary">Sources</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            {sources.map((s) => (
              <span key={s} className="rounded-full bg-card px-3 py-1.5 text-[13px] font-semibold shadow-sm">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {item.kind === "update" && current && (
        <div className="mt-4 rounded-inner bg-amber-soft px-4 py-2.5 text-[13px] font-medium text-amber">
          Proposed update to the published article{article.staleReason ? ` — ${article.staleReason}` : ""}. Changed blocks are
          highlighted below.
        </div>
      )}

      {editing ? (
        <div className="mt-4 flex flex-col gap-3">
          <Input value={title} onChange={(e) => { setTitle(e.target.value); setEdited(true); }} className="font-semibold" />
          <Input value={summary} placeholder="Summary" onChange={(e) => { setSummary(e.target.value); setEdited(true); }} />
          {blocks.map((b, i) => (
            <div key={i} className="rounded-card bg-card p-4 shadow-card">
              <SectionLabel>{kindLabels[b.kind] ?? b.kind}</SectionLabel>
              <input
                value={b.conditionText}
                placeholder="Condition (optional)"
                onChange={(e) => updateBlock(i, { conditionText: e.target.value })}
                className="mt-1 w-full bg-transparent text-[13px] font-semibold text-primary outline-none placeholder:font-normal placeholder:text-ink-faint"
              />
              <textarea
                rows={4}
                value={b.contentMd}
                onChange={(e) => updateBlock(i, { contentMd: e.target.value })}
                className="mt-1.5 w-full resize-y bg-transparent text-[15px] leading-relaxed outline-none"
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          <h1 className="mt-5 text-[24px] font-bold leading-tight tracking-tight">{title}</h1>
          {summary && <p className="mt-1.5 text-[14px] text-ink-secondary">{summary}</p>}
          <div className="mt-4 flex flex-col gap-3">
            {blocks.map((b, i) => {
              const changed =
                item.kind === "update" &&
                current != null &&
                !current.blocks.some((cb) => cb.kind === b.kind && cb.contentMd === b.contentMd);
              return (
                <div key={i} className={`rounded-card bg-card p-4 shadow-card ${changed ? "ring-2 ring-primary/50" : ""}`}>
                  <div className="flex items-center justify-between">
                    <SectionLabel>{kindLabels[b.kind] ?? b.kind}</SectionLabel>
                    {changed && <span className="rounded-md bg-mint px-2 py-0.5 text-[11px] font-bold text-primary">CHANGED</span>}
                  </div>
                  {b.conditionText && <div className="mt-1 text-[13px] font-semibold text-primary">If: {b.conditionText}</div>}
                  <Markdown text={b.contentMd} className="mt-1" />
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* near-duplicate warning: merge into an existing doc instead of publishing both */}
      {similar.length > 0 && (
        <div className="mt-4 rounded-card bg-surface p-4">
          <SectionLabel>Similar existing articles</SectionLabel>
          <p className="mt-0.5 text-[13px] text-ink-secondary">Covers the same ground? Merge instead of publishing a duplicate.</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {similar.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-inner bg-card p-3 shadow-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-ink">
                    {a.kb} · {a.title}
                  </div>
                  {a.summary && <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-secondary">{a.summary}</div>}
                  {a.similarity != null && (
                    <div className="mt-0.5 text-[12px] font-semibold text-primary">{Math.round(a.similarity * 100)}% similar</div>
                  )}
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0"
                  loading={merge.isPending && merge.variables === a.id}
                  disabled={merge.isPending}
                  onClick={() => {
                    if (window.confirm(`Merge this draft into ${a.kb} · "${a.title}"? kloop creates a merge proposal for review; ${a.kb} keeps its number.`)) {
                      merge.mutate(a.id);
                    }
                  }}
                >
                  Merge into {a.kb}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(approve.isError || reject.isError || merge.isError) && (
        <div className="mt-4">
          <ErrorNote>{((approve.error ?? reject.error ?? merge.error) as Error).message}</ErrorNote>
        </div>
      )}

      {/* bottom bar: Reject / Approve & publish */}
      <div className="fixed inset-x-0 bottom-20 z-20 px-4 md:bottom-6 md:pl-64">
        <div className="mx-auto flex max-w-xl gap-2.5">
          <Button variant="danger" className="flex-1 shadow-float" loading={reject.isPending} onClick={() => reject.mutate()}>
            {t("reviews.reject")}
          </Button>
          <Button className="flex-[2] shadow-float" loading={approve.isPending} onClick={() => approve.mutate()}>
            {edited ? "Approve with edits" : "Approve & publish"}
          </Button>
        </div>
      </div>
    </div>
  );

  function updateBlock(i: number, patch: Partial<{ conditionText: string; contentMd: string }>) {
    setEdited(true);
    setBlocks((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }
}

/* ===================================================================== */
/* Merge review — 3-pane: A | B | proposed merge with diff + rationale   */
/* ===================================================================== */

function MergeReview({ payload }: { payload: MergePayload }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { item, mergeCandidate, articleA, articleB } = payload;
  const proposal = mergeCandidate.proposal;

  const done = () => {
    void qc.invalidateQueries({ queryKey: ["reviews"] });
    void qc.invalidateQueries({ queryKey: ["review-counts"] });
    void qc.invalidateQueries({ queryKey: ["articles"] });
    navigate("/reviews", { replace: true });
  };
  const approve = useMutation({ mutationFn: () => api.approveReview(item.id), onSuccess: done });
  const reject = useMutation({ mutationFn: () => api.rejectReview(item.id), onSuccess: done });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-36 pt-4">
      <BackBar
        title={`Merge · ${articleA?.kb ?? "?"} + ${articleB?.kb ?? "?"}`}
        subtitle={`composite score ${Math.round(mergeCandidate.compositeScore * 100)}%${mergeCandidate.verdict ? ` · ${mergeCandidate.verdict}` : ""}`}
      />

      {proposal?.rationale && (
        <div className="mt-4 rounded-card bg-mint p-4">
          <SectionLabel className="!text-primary">Why merge these?</SectionLabel>
          <p className="mt-1 text-[14px] leading-relaxed text-ink">{proposal.rationale}</p>
        </div>
      )}

      {/* 3-pane on desktop, stacked on mobile */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <MergePane title={articleA ? `${articleA.kb} · ${articleA.title}` : "Article A"} tone="side" blocks={articleA?.blocks ?? []} />
        <MergePane title={articleB ? `${articleB.kb} · ${articleB.title}` : "Article B"} tone="side" blocks={articleB?.blocks ?? []} />
        <MergePane
          title={proposal ? `Proposed · ${proposal.mergedTitle}` : "Proposed merge"}
          tone="proposed"
          blocks={(proposal?.blocks ?? []).map((b, i) => ({ id: String(i), kind: b.kind, conditionText: b.conditionText ?? null, contentMd: b.contentMd }))}
          origins={(proposal?.blocks ?? []).map((b) => b.origin)}
        />
      </div>

      {(proposal?.diff.length ?? 0) > 0 && (
        <div className="mt-4 rounded-card bg-card p-4 shadow-card">
          <SectionLabel>What changes</SectionLabel>
          <ul className="mt-2 flex flex-col gap-1.5">
            {proposal!.diff.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-[14px]">
                <span
                  className={`mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    d.op === "keep" ? "bg-chip text-ink-secondary" : d.op === "drop" ? "bg-danger-soft text-danger" : "bg-mint text-primary"
                  }`}
                >
                  {d.op}
                </span>
                <span className="text-ink">
                  <span className="font-semibold">{kindLabels[d.blockKind] ?? d.blockKind}:</span> {d.text}
                  {d.from ? <span className="text-ink-secondary"> (from {d.from})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(approve.isError || reject.isError) && (
        <div className="mt-4">
          <ErrorNote>{((approve.error ?? reject.error) as Error).message}</ErrorNote>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-20 z-20 px-4 md:bottom-6 md:pl-64">
        <div className="mx-auto flex max-w-xl gap-2.5">
          <Button variant="danger" className="flex-1 shadow-float" loading={reject.isPending} onClick={() => reject.mutate()}>
            Keep separate
          </Button>
          <Button className="flex-[2] shadow-float" loading={approve.isPending} disabled={!proposal} onClick={() => approve.mutate()}>
            {t("reviews.approve")} merge
          </Button>
        </div>
      </div>
    </div>
  );
}

function MergePane({
  title,
  blocks,
  tone,
  origins,
}: {
  title: string;
  blocks: BlockShape[];
  tone: "side" | "proposed";
  origins?: (string | undefined)[];
}) {
  return (
    <div className={`rounded-card p-4 ${tone === "proposed" ? "bg-card shadow-card ring-2 ring-primary/40" : "bg-surface"}`}>
      <div className="mb-3 text-[14px] font-bold leading-snug">{title}</div>
      <div className="flex flex-col gap-2.5">
        {blocks.map((b, i) => (
          <div key={b.id ?? i} className="rounded-inner bg-bg/60 p-3">
            <div className="flex items-center justify-between">
              <SectionLabel>{kindLabels[b.kind] ?? b.kind}</SectionLabel>
              {origins?.[i] && <span className="text-[10px] font-bold uppercase text-ink-faint">{origins[i]}</span>}
            </div>
            {b.conditionText && <div className="mt-0.5 text-[12px] font-semibold text-primary">If: {b.conditionText}</div>}
            <Markdown text={b.contentMd} className="mt-0.5 text-[13px]" />
          </div>
        ))}
        {blocks.length === 0 && <div className="text-[13px] text-ink-faint">No published content</div>}
      </div>
    </div>
  );
}
