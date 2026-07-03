import { describe, expect, it } from "vitest";
import { articleToMarkdown } from "./articles.js";

describe("articleToMarkdown (block flattening — the no-lock-in export)", () => {
  it("groups consecutive blocks under one heading and renders conditions", () => {
    const md = articleToMarkdown(
      "Printer offline on macOS",
      "Resume the queue or re-add the printer.",
      "KB-032",
      [
        { kind: "symptoms", conditionText: null, contentMd: "- Shows offline" },
        { kind: "resolution", conditionText: "After waking from sleep", contentMd: "1. Resume the queue" },
        { kind: "resolution", conditionText: "After a macOS update", contentMd: "1. Remove and re-add the printer" },
        { kind: "notes", conditionText: null, contentMd: "No driver reinstall needed." },
      ],
    );

    expect(md).toContain("# Printer offline on macOS");
    expect(md).toContain("> KB-032 — Resume the queue or re-add the printer.");
    expect(md).toContain("## Symptoms");
    expect(md).toContain("## Notes");
    // two conditioned resolution branches, but only ONE "## Resolution" heading
    expect(md.match(/## Resolution/g)).toHaveLength(1);
    expect(md).toContain("**If: After waking from sleep**");
    expect(md).toContain("**If: After a macOS update**");
    // condition precedes its branch content
    expect(md.indexOf("**If: After waking from sleep**")).toBeLessThan(md.indexOf("1. Resume the queue"));
  });

  it("handles unknown block kinds gracefully", () => {
    const md = articleToMarkdown("T", "", "KB-001", [{ kind: "custom", conditionText: null, contentMd: "x" }]);
    expect(md).toContain("## custom");
  });
});
