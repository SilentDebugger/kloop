/**
 * Reciprocal Rank Fusion — the heart of hybrid search.
 * Pure vector search misses exact identifiers ("error 0x80070005");
 * pure keyword search misses paraphrases. RRF fuses both rankings without
 * needing score calibration between them.
 */
export type RankedList = { id: string; extra?: Record<string, unknown> }[];

const RRF_K = 60;

export function rrfFuse(
  lists: RankedList[],
  weights?: number[],
): { id: string; score: number; extra: Record<string, unknown> }[] {
  const scores = new Map<string, { score: number; extra: Record<string, unknown> }>();
  lists.forEach((list, li) => {
    const weight = weights?.[li] ?? 1;
    list.forEach((item, rank) => {
      const entry = scores.get(item.id) ?? { score: 0, extra: {} };
      entry.score += weight / (RRF_K + rank + 1);
      if (item.extra) entry.extra = { ...entry.extra, ...item.extra };
      scores.set(item.id, entry);
    });
  });
  return [...scores.entries()]
    .map(([id, { score, extra }]) => ({ id, score, extra }))
    .sort((a, b) => b.score - a.score);
}

/** cosine similarity for in-memory vectors (assumes same length) */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
