import { describe, expect, it } from "vitest";
import { compositeScore, tagOverlap, verdictOf, type Scores } from "./merge.js";

const base: Scores = {
  simSummary: 0,
  simSymptoms: 0,
  simResolution: 0,
  clusterOverlap: 0,
  coRetrieval: 0,
  entityOverlap: 0,
};

describe("compositeScore", () => {
  it("is bounded to [0, 1]", () => {
    expect(compositeScore(base)).toBe(0);
    expect(
      compositeScore({ simSummary: 1, simSymptoms: 1, simResolution: 1, clusterOverlap: 1, coRetrieval: 1, entityOverlap: 1 }),
    ).toBeCloseTo(1);
  });

  it("weights symptom+summary similarity heaviest", () => {
    const symptomsDriven = compositeScore({ ...base, simSummary: 0.9, simSymptoms: 0.9 });
    const auxiliaryDriven = compositeScore({ ...base, clusterOverlap: 0.9, entityOverlap: 0.9 });
    expect(symptomsDriven).toBeGreaterThan(auxiliaryDriven);
  });

  it("crosses the proposal threshold only for genuinely similar pairs", () => {
    const near = compositeScore({
      simSummary: 0.87,
      simSymptoms: 0.81,
      simResolution: 0.78,
      clusterOverlap: 0.5,
      coRetrieval: 0.64,
      entityOverlap: 0.67,
    });
    expect(near).toBeGreaterThan(0.62); // COMPOSITE_THRESHOLD

    const far = compositeScore({ ...base, simSummary: 0.7, entityOverlap: 0.5 });
    expect(far).toBeLessThan(0.62);
  });
});

describe("verdictOf", () => {
  it("classifies duplicates as merge (same symptoms, same fix)", () => {
    expect(verdictOf({ ...base, simSymptoms: 0.9, simResolution: 0.85 })).toBe("merge");
  });

  it("classifies same problem / different fixes as branch", () => {
    expect(verdictOf({ ...base, simSymptoms: 0.9, simResolution: 0.3 })).toBe("branch");
  });

  it("classifies different problems / same fix as crosslink", () => {
    expect(verdictOf({ ...base, simSymptoms: 0.2, simResolution: 0.9 })).toBe("crosslink");
  });

  it("classifies unrelated pairs as fork", () => {
    expect(verdictOf({ ...base, simSymptoms: 0.3, simResolution: 0.3 })).toBe("fork");
  });
});

describe("tagOverlap", () => {
  it("is jaccard over tag sets", () => {
    expect(tagOverlap(["vpn", "network"], ["vpn", "remote"])).toBeCloseTo(1 / 3);
    expect(tagOverlap(["a"], ["a"])).toBe(1);
  });

  it("is 0 when either side has no tags", () => {
    expect(tagOverlap([], ["a"])).toBe(0);
    expect(tagOverlap(["a"], [])).toBe(0);
  });
});
