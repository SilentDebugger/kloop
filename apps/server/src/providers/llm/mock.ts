import type { CompleteOptions, LlmProvider } from "./types.js";

/**
 * Deterministic, key-free "LLM". Template-based but genuinely functional:
 * every engine feature (article drafting, structuring, merge proposals,
 * reply drafts) produces sensible output, so the whole product runs with
 * LLM_PROVIDER=mock. Real deployments switch a single env var.
 */
export class MockLlmProvider implements LlmProvider {
  name = "mock";
  model = "mock-templates-v1";

  async complete(opts: CompleteOptions): Promise<string> {
    switch (opts.task) {
      case "structure_capture":
        return JSON.stringify(this.structureCapture(opts.data ?? {}));
      case "article_draft":
        return JSON.stringify(this.articleDraft(opts.data ?? {}));
      case "reply_draft":
        return JSON.stringify(this.replyDraft(opts.data ?? {}));
      case "merge_proposal":
        return JSON.stringify(this.mergeProposal(opts.data ?? {}));
      case "update_proposal":
        return JSON.stringify(this.updateProposal(opts.data ?? {}));
      case "cluster_label":
        return JSON.stringify(this.clusterLabel(opts.data ?? {}));
      case "auto_answer":
        return JSON.stringify(this.autoAnswer(opts.data ?? {}));
      default:
        return opts.json ? "{}" : "ok";
    }
  }

  private sentences(text: string): string[] {
    return text
      .replace(/\n+/g, ". ")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim().replace(/^[-*\d.)\s]+/, ""))
      .filter((s) => s.length > 2);
  }

  private structureCapture(data: Record<string, unknown>): unknown {
    const raw = String(data.raw ?? "");
    const steps = this.sentences(raw).map((s) => (s.endsWith(".") ? s : `${s}.`));
    const summary = steps[0] ?? raw.slice(0, 140);
    return { summary, steps };
  }

  private articleDraft(data: Record<string, unknown>): unknown {
    const requestTitles = (data.requestTitles as string[] | undefined) ?? [];
    const resolutions = (data.resolutions as { summary?: string; raw?: string }[] | undefined) ?? [];
    const environment = (data.environment as string | undefined) ?? null;

    const title = String(data.suggestedTitle ?? requestTitles[0] ?? "Untitled issue");
    const symptomLines = requestTitles.slice(0, 4).map((t) => `- ${t}`);
    const steps: string[] = [];
    for (const r of resolutions) {
      for (const s of this.sentences(r.summary || r.raw || "")) {
        if (!steps.some((x) => x.toLowerCase() === s.toLowerCase())) steps.push(s);
      }
    }
    return {
      title,
      summary: `How to resolve: ${title}. Distilled from ${resolutions.length} captured resolution${resolutions.length === 1 ? "" : "s"}.`,
      blocks: [
        {
          kind: "symptoms",
          contentMd: symptomLines.length > 0 ? symptomLines.join("\n") : `- ${title}`,
        },
        ...(environment ? [{ kind: "environment", contentMd: environment }] : []),
        {
          kind: "resolution",
          contentMd: steps.length > 0 ? steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : "1. See linked resolutions.",
        },
        {
          kind: "notes",
          contentMd: `Generated automatically from resolved requests. Review before publishing.`,
        },
      ],
      confidence: Math.min(0.9, 0.5 + resolutions.length * 0.15),
    };
  }

  private replyDraft(data: Record<string, unknown>): unknown {
    const requesterName = String(data.requesterName ?? "there");
    const articleTitle = data.articleTitle ? String(data.articleTitle) : null;
    const steps = (data.articleSteps as string[] | undefined) ?? [];
    const precedent = data.precedentSummary ? String(data.precedentSummary) : null;

    let body = `Hi ${requesterName.split(" ")[0]} — `;
    if (articleTitle && steps.length > 0) {
      body += `this looks like a known issue: "${articleTitle}".\n\n${steps
        .slice(0, 5)
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n")}\n\nLet me know if that fixes it.`;
    } else if (precedent) {
      body += `we've seen something similar before. ${precedent}\n\nLet me know if that helps.`;
    } else {
      body += `thanks for the report — I'm looking into it and will get back to you shortly.`;
    }
    return { body };
  }

  private mergeProposal(data: Record<string, unknown>): unknown {
    type Art = { title?: string; summary?: string; blocks?: { kind: string; contentMd: string; conditionText?: string | null }[] };
    const a = (data.a ?? {}) as Art;
    const b = (data.b ?? {}) as Art;
    const kindOrder = ["symptoms", "environment", "resolution", "notes"];

    const blocks: { kind: string; conditionText: string | null; contentMd: string; origin: string }[] = [];
    for (const kind of kindOrder) {
      const aBlocks = (a.blocks ?? []).filter((x) => x.kind === kind);
      const bBlocks = (b.blocks ?? []).filter((x) => x.kind === kind);
      if (kind === "symptoms" || kind === "notes") {
        // union, deduplicated line-wise
        const lines = new Set<string>();
        for (const blk of [...aBlocks, ...bBlocks]) for (const l of blk.contentMd.split("\n")) if (l.trim()) lines.add(l.trim());
        if (lines.size > 0) blocks.push({ kind, conditionText: null, contentMd: [...lines].join("\n"), origin: "merged" });
      } else if (kind === "resolution") {
        const same =
          aBlocks.map((x) => x.contentMd).join("\n") === bBlocks.map((x) => x.contentMd).join("\n");
        if (same && aBlocks.length > 0) {
          blocks.push({ kind, conditionText: null, contentMd: aBlocks.map((x) => x.contentMd).join("\n"), origin: "identical" });
        } else {
          for (const blk of aBlocks)
            blocks.push({ kind, conditionText: blk.conditionText ?? `Applies to: ${a.title ?? "variant A"}`, contentMd: blk.contentMd, origin: "a" });
          for (const blk of bBlocks)
            blocks.push({ kind, conditionText: blk.conditionText ?? `Applies to: ${b.title ?? "variant B"}`, contentMd: blk.contentMd, origin: "b" });
        }
      } else {
        for (const blk of [...aBlocks, ...bBlocks])
          blocks.push({ kind, conditionText: blk.conditionText ?? null, contentMd: blk.contentMd, origin: aBlocks.includes(blk) ? "a" : "b" });
      }
    }

    const diff = blocks.map((blk) => ({
      op: blk.origin === "merged" ? "combined" : blk.origin === "identical" ? "kept" : "conditioned",
      blockKind: blk.kind,
      text: blk.contentMd.slice(0, 120),
      from: blk.origin,
    }));

    return {
      mergedTitle: a.title ?? b.title ?? "Merged article",
      mergedSummary: `${a.summary ?? ""} ${b.summary ?? ""}`.trim().slice(0, 300),
      blocks,
      diff,
      rationale: `Both articles describe overlapping symptoms. Symptoms and notes were combined; differing resolution steps were kept as conditioned branches.`,
      confidence: 0.7,
    };
  }

  private updateProposal(data: Record<string, unknown>): unknown {
    const blocks = (data.blocks as { kind: string; contentMd: string }[] | undefined) ?? [];
    const resolutionSummary = String(data.resolutionSummary ?? "");
    const updated = blocks.map((b) => ({ ...b, conditionText: null, origin: "kept" }));
    updated.push({
      kind: "notes",
      contentMd: `Recent resolution suggests an update: ${resolutionSummary}`,
      conditionText: null,
      origin: "new",
    } as never);
    return {
      blocks: updated,
      rationale: `A recent resolution disagrees with the documented steps; proposed as an additional note pending human review.`,
      confidence: 0.6,
    };
  }

  private clusterLabel(data: Record<string, unknown>): unknown {
    const titles = (data.titles as string[] | undefined) ?? [];
    const stop = new Set(["the", "a", "an", "is", "are", "not", "on", "in", "at", "to", "my", "for", "of", "and", "or", "after", "with", "wont", "won't", "cant", "can't", "does", "doesn't"]);
    const freq = new Map<string, number>();
    for (const t of titles)
      for (const w of t.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/))
        if (w.length > 2 && !stop.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    const top = [...freq.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([w]) => w);
    return { label: top.join(" ") || "untitled cluster" };
  }

  private autoAnswer(data: Record<string, unknown>): unknown {
    const articleTitle = String(data.articleTitle ?? "a documented solution");
    const steps = (data.articleSteps as string[] | undefined) ?? [];
    return {
      body: `This looks like a known issue — "${articleTitle}":\n\n${steps
        .slice(0, 6)
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n")}\n\nDid this solve your problem? If not, reply "didn't help" and a supporter will take over.`,
    };
  }
}
