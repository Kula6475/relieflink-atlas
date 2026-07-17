import { describe, expect, it } from "vitest";
import {
  forecastDemand,
  haversine,
  networkBalanceTarget,
  severityMultiplier,
} from "./operational";

describe("operational agent models", () => {
  it("fits a rising dispatch trend and applies disruption impact", () => {
    const result = forecastDemand([10, 12, 14, 16], 1.5);
    expect(result.method).toContain("least-squares");
    expect(result.trend).toBe(2);
    expect(result.forecast).toBe(27);
  });

  it("uses the strongest live event multiplier", () => {
    expect(
      severityMultiplier([
        { source: "weather.gov", severity: "Moderate" },
        { source: "openfema", severity: "Severe" },
      ]),
    ).toBe(1.5);
  });

  it("balances fresh spreadsheet inventories without inventing demand", () => {
    expect(networkBalanceTarget(20, [100])).toBe(60);
    expect(networkBalanceTarget(20, [])).toBe(0);
  });

  it("calculates realistic route distance", () => {
    const miles = haversine(
      {
        id: "a",
        name: "Oakland",
        county: "Alameda",
        state: "CA",
        latitude: 37.8044,
        longitude: -122.2712,
      },
      {
        id: "b",
        name: "Fremont",
        county: "Alameda",
        state: "CA",
        latitude: 37.5485,
        longitude: -121.9886,
      },
    );
    expect(miles).toBeGreaterThan(20);
    expect(miles).toBeLessThan(30);
  });
});
