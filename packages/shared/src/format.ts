import type { AutoAnswerSkip, DocState } from "./types.js";

const pct = (n?: number) => `${Math.round((n ?? 0) * 100)}%`;

/** One-line supporter-facing explanation of why the AI skipped auto-answering. */
export function autoAnswerSkipLabel(skip: AutoAnswerSkip): string {
  switch (skip.reason) {
    case "below_confidence":
      return `AI skipped auto-answer — best match "${skip.articleTitle ?? "untitled"}" at ${pct(skip.similarity)}, needs ${pct(skip.threshold)}`;
    case "no_article_match":
      return "AI skipped auto-answer — no matching article found";
    case "article_has_no_steps":
      return `AI skipped auto-answer — "${skip.articleTitle ?? "the matched article"}" has no resolution steps`;
    case "tag_tier_override":
      return "AI skipped auto-answer — a tag on this request caps automation below tier 2";
    case "generation_failed":
      return "AI skipped auto-answer — the reply couldn't be generated";
  }
}

/** Short headline per documentation pipeline state — shared by the activity feed and thread. */
export function docStateLabel(state: DocState): string {
  switch (state) {
    case "working":
      return "Writing this up…";
    case "drafted":
      return "New draft ready for review";
    case "already_documented":
      return "Already documented";
    case "covered_by_draft":
      return "Covered by a pending draft";
    case "skipped":
      return "Nothing to document";
    case "failed":
      return "Couldn't finish";
  }
}
