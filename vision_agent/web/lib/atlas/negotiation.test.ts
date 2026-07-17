import { describe, expect, it } from "vitest";
import {
  boundedOffer,
  explainNegotiation,
  verifiedSurplus,
} from "./negotiation";
describe("site negotiation", () => {
  it("never offers safety stock or inventory already committed", () => {
    expect(verifiedSurplus(100, 30, 25)).toBe(45);
    expect(verifiedSurplus(40, 30, 15)).toBe(0);
    expect(boundedOffer(80, 45)).toBe(45);
    expect(boundedOffer(20, 45)).toBe(20);
  });

  it("uses a deterministic explanation without an API key", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = await explainNegotiation({
      requestingSite: "Branch A",
      requestingAgent: "A Agent",
      donorSite: "Branch B",
      donorAgent: "B Agent",
      category: "produce",
      requested: 40,
      offered: 30,
      verifiedSurplus: 30,
      safetyStock: 20,
      distanceMiles: 5,
    });
    expect(result.mode).toBe("rules");
    expect(result.explanation).toContain("offered 30");
    if (previous) process.env.OPENAI_API_KEY = previous;
  });
});
