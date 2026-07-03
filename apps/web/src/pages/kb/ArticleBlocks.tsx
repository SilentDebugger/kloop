import type { ArticleBlockView } from "@kloop/shared";
import { Markdown } from "../../lib/markdown";
import { SectionLabel } from "../../ui";

const blockLabels: Record<ArticleBlockView["kind"], string> = {
  symptoms: "Symptoms",
  environment: "Environment",
  resolution: "Resolution steps",
  notes: "Notes",
};

/**
 * The block-tree body of an article, rendered as the stacked labeled cards
 * from the mockups. Notes render as the gray "why this happens" inset.
 */
export function ArticleBlocks({
  blocks,
  provenance,
  compact,
}: {
  blocks: ArticleBlockView[];
  provenance?: { blockId: string; ref: string | null }[];
  compact?: boolean;
}) {
  const refsFor = (blockId: string) =>
    [...new Set((provenance ?? []).filter((p) => p.blockId === blockId && p.ref).map((p) => p.ref!))];

  return (
    <div className={`flex flex-col ${compact ? "gap-2.5" : "gap-3"}`}>
      {blocks.map((b) => {
        const refs = refsFor(b.id);
        if (b.kind === "notes") {
          return (
            <div key={b.id} className="rounded-inner bg-chip/70 p-4">
              <Markdown text={b.contentMd} className="text-[14px] text-ink-secondary" />
              {refs.length > 0 && <ProvenanceRefs refs={refs} />}
            </div>
          );
        }
        return (
          <div key={b.id} className="rounded-card bg-card p-4 shadow-card">
            <SectionLabel>{blockLabels[b.kind] ?? b.kind}</SectionLabel>
            {b.conditionText && (
              <div className="mt-1 text-[13px] font-semibold text-primary">If: {b.conditionText}</div>
            )}
            <Markdown text={b.contentMd} className="mt-1" />
            {refs.length > 0 && <ProvenanceRefs refs={refs} />}
          </div>
        );
      })}
    </div>
  );
}

function ProvenanceRefs({ refs }: { refs: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <span key={r} className="rounded-md bg-chip px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">
          {r}
        </span>
      ))}
    </div>
  );
}
