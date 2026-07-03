import { describe, expect, it } from "vitest";
import { extractJson } from "./types.js";

describe("extractJson (LLM output hardening)", () => {
  it("parses clean JSON", () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses fenced code blocks", () => {
    expect(extractJson<{ body: string }>('```json\n{"body": "hi"}\n```')).toEqual({ body: "hi" });
    expect(extractJson<{ body: string }>('```\n{"body": "hi"}\n```')).toEqual({ body: "hi" });
  });

  it("extracts JSON buried in prose", () => {
    expect(extractJson<{ ok: boolean }>('Sure! Here is the result: {"ok": true} Hope that helps.')).toEqual({ ok: true });
  });

  it("extracts arrays too", () => {
    expect(extractJson<number[]>("the tags are [1, 2, 3] as requested")).toEqual([1, 2, 3]);
  });

  it("throws a readable error on garbage", () => {
    expect(() => extractJson("I cannot answer that.")).toThrow(/did not return valid JSON/);
  });
});
