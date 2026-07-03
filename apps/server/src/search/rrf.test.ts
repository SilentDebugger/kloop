import { describe, expect, it } from "vitest";
import { cosineSim, rrfFuse } from "./rrf.js";

describe("rrfFuse", () => {
  it("ranks items appearing in both lists above single-list items", () => {
    const fused = rrfFuse([
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [{ id: "b" }, { id: "d" }],
    ]);
    expect(fused[0].id).toBe("b"); // rank 2 + rank 1 beats a single rank 1
    expect(fused.map((f) => f.id)).toContain("d");
  });

  it("respects list weights", () => {
    const unweighted = rrfFuse([[{ id: "vec-top" }], [{ id: "kw-top" }]]);
    // equal single-entry lists tie; weighting the second list must break the tie
    expect(unweighted[0].score).toBeCloseTo(unweighted[1].score);

    const weighted = rrfFuse([[{ id: "vec-top" }], [{ id: "kw-top" }]], [1, 2]);
    expect(weighted[0].id).toBe("kw-top");
  });

  it("keeps exact-identifier hits from the keyword list in the fused set", () => {
    // the reason hybrid search exists: vectors miss "error 0x80070005"
    const vecList = Array.from({ length: 10 }, (_, i) => ({ id: `v${i}` }));
    const kwList = [{ id: "exact-error-code-hit" }];
    const fused = rrfFuse([vecList, kwList]);
    expect(fused.some((f) => f.id === "exact-error-code-hit")).toBe(true);
    // rank 1 in the keyword list outranks rank 3+ vector hits
    const kwRank = fused.findIndex((f) => f.id === "exact-error-code-hit");
    expect(kwRank).toBeLessThan(3);
  });

  it("merges extras from both lists", () => {
    const fused = rrfFuse([
      [{ id: "a", extra: { title: "T" } }],
      [{ id: "a", extra: { snippet: "S" } }],
    ]);
    expect(fused[0].extra).toEqual({ title: "T", snippet: "S" });
  });

  it("returns empty for empty input", () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([[], []])).toEqual([]);
  });
});

describe("cosineSim", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("handles zero vectors without NaN", () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });
});
