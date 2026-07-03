import { describe, expect, it } from "vitest";
import { effectiveTier } from "./automation.js";
import type { tables } from "../db/index.js";

function orgWith(settings: Record<string, unknown>): typeof tables.orgs.$inferSelect {
  return {
    id: "org-1",
    name: "Test",
    slug: "test",
    domain: null,
    logoUrl: null,
    theme: {},
    settings,
    createdAt: new Date(),
  } as typeof tables.orgs.$inferSelect;
}

describe("effectiveTier", () => {
  it("returns the org-wide tier when no overrides match", () => {
    const org = orgWith({ automationTier: 3, tagTierOverrides: {} });
    expect(effectiveTier(org, ["vpn"])).toBe(3);
  });

  it("most restrictive wins: tag override lowers the tier", () => {
    const org = orgWith({ automationTier: 3, tagTierOverrides: { security: 0 } });
    expect(effectiveTier(org, ["security"])).toBe(0);
    expect(effectiveTier(org, ["printer"])).toBe(3);
  });

  it("a tag override can never raise the tier above the org setting", () => {
    const org = orgWith({ automationTier: 1, tagTierOverrides: { printer: 3 } });
    expect(effectiveTier(org, ["printer"])).toBe(1);
  });

  it("with multiple tags, the lowest override applies", () => {
    const org = orgWith({ automationTier: 3, tagTierOverrides: { hr: 1, payroll: 0 } });
    expect(effectiveTier(org, ["hr", "payroll", "misc"])).toBe(0);
  });

  it("defaults to tier 0 when settings are missing", () => {
    const org = orgWith({});
    expect(effectiveTier(org, [])).toBe(0);
  });
});
