export type DemoAllocation = { source: "donor" | "vendor"; offered: number; allocated: number };

export function calculateShortage(forecast: number, onHand: number, reserved = 0) {
  return Math.max(0, forecast - Math.max(0, onHand - reserved));
}

export function allocateDemoRequest(input: {
  ideal: number; minimum: number; maximum: number; donorOffer: number; vendorOffer: number; logisticsCap: number;
}) {
  if (input.minimum > input.ideal || input.ideal > input.maximum) throw new Error("Request bounds must satisfy minimum ≤ ideal ≤ maximum");
  const target = Math.min(input.ideal, input.maximum, input.logisticsCap, input.donorOffer + input.vendorOffer);
  if (target < input.minimum) return { feasible: false, total: target, allocations: [] as DemoAllocation[] };
  const donor = Math.min(input.donorOffer, target);
  const vendor = Math.min(input.vendorOffer, target - donor);
  return { feasible: true, total: donor + vendor, allocations: [
    { source: "donor" as const, offered: input.donorOffer, allocated: donor },
    { source: "vendor" as const, offered: input.vendorOffer, allocated: vendor },
  ].filter((allocation) => allocation.allocated > 0) };
}

export function approvalsRemainValid(approvedVersion: number, proposalVersion: number) {
  return approvedVersion === proposalVersion;
}

export function nextShipmentStatus(current: string, action: "dispatch" | "receive") {
  if (action === "dispatch" && current === "reserved") return "dispatched";
  if (action === "receive" && ["dispatched", "in_transit"].includes(current)) return "received";
  if (action === "dispatch" && current === "dispatched") return "dispatched";
  if (action === "receive" && current === "received") return "received";
  throw new Error(`Cannot ${action} a ${current} shipment`);
}
