import { describe, expect, it } from "vitest";
import { cosineSim } from "../../search/rrf.js";
import { MockEmbeddingProvider } from "./mock.js";
import { fitDimensions } from "./types.js";

describe("MockEmbeddingProvider", () => {
  const provider = new MockEmbeddingProvider();

  it("is deterministic: identical text → identical vector", async () => {
    const [a] = await provider.embed(["vpn drops on hotel wifi"]);
    const [b] = await provider.embed(["vpn drops on hotel wifi"]);
    expect(a).toEqual(b);
  });

  it("produces L2-normalized vectors of the configured dimension", async () => {
    const [vec] = await provider.embed(["hello world"]);
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("shared tokens → higher cosine similarity than unrelated text", async () => {
    const [vpn1, vpn2, unrelated] = await provider.embed([
      "vpn keeps dropping on hotel wifi",
      "hotel wifi vpn disconnects every few minutes",
      "quarterly payroll report for the accounting team",
    ]);
    expect(cosineSim(vpn1, vpn2)).toBeGreaterThan(cosineSim(vpn1, unrelated));
  });

  it("does not support media embedding (falls back to extracted text)", async () => {
    expect(await provider.embedMedia()).toBeNull();
  });
});

describe("fitDimensions", () => {
  it("truncates oversized vectors and re-normalizes", () => {
    const out = fitDimensions([3, 4, 100, 100], 2);
    expect(out).toHaveLength(2);
    expect(Math.sqrt(out[0] ** 2 + out[1] ** 2)).toBeCloseTo(1);
  });

  it("zero-pads undersized vectors", () => {
    const out = fitDimensions([1], 4);
    expect(out).toEqual([1, 0, 0, 0]);
  });

  it("survives the zero vector", () => {
    expect(fitDimensions([0, 0], 2)).toEqual([0, 0]);
  });
});
