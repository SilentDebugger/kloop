import type { AutoAnswerSkip } from "./types.js";

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
