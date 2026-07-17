import {describe,expect,it} from "vitest";
import {allocateDemoRequest,approvalsRemainValid,calculateShortage,nextShipmentStatus} from "./demo-engine";

describe("judge demo allocation",()=>{
  it("allocates 100 donor and 50 vendor under the logistics cap",()=>expect(allocateDemoRequest({ideal:200,minimum:150,maximum:220,donorOffer:100,vendorOffer:80,logisticsCap:150})).toMatchObject({feasible:true,total:150,allocations:[{source:"donor",allocated:100},{source:"vendor",allocated:50}]}));
  it("rejects a plan below minimum",()=>expect(allocateDemoRequest({ideal:200,minimum:150,maximum:220,donorOffer:40,vendorOffer:40,logisticsCap:150}).feasible).toBe(false));
  it("enforces valid request bounds",()=>expect(()=>allocateDemoRequest({ideal:140,minimum:150,maximum:220,donorOffer:100,vendorOffer:80,logisticsCap:150})).toThrow());
});
describe("inventory lifecycle",()=>{
  it("computes the initial shortage",()=>expect(calculateShortage(325,175)).toBe(150));
  it("recalculates shortage after receipt",()=>expect(calculateShortage(325,325)).toBe(0));
  it("protects safety stock through reservation math",()=>expect(calculateShortage(250,250,150)).toBe(150));
  it("invalidates approvals after a quantity version change",()=>expect(approvalsRemainValid(1,2)).toBe(false));
  it("keeps approvals valid for an unchanged proposal",()=>expect(approvalsRemainValid(2,2)).toBe(true));
  it("dispatches then receives",()=>expect(nextShipmentStatus(nextShipmentStatus("reserved","dispatch"),"receive")).toBe("received"));
  it("is idempotent for repeated shipment actions",()=>{expect(nextShipmentStatus("dispatched","dispatch")).toBe("dispatched");expect(nextShipmentStatus("received","receive")).toBe("received")});
});
