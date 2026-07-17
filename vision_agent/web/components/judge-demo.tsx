"use client";
import { useEffect, useState } from "react";
import { apiJson } from "./client-api";

type DemoState = {
  seeded: boolean;
  proposal?: {
    status: string;
    ideal: number;
    minimum: number;
    maximum: number;
    recommended: number;
    calculation: any;
    plan: any;
  };
  approvals?: Array<{
    id: string;
    organization: string;
    role: string;
    status: string;
  }>;
  reservations?: Array<{ source: string; quantity: number; status: string }>;
  shipment?: { status: string } | null;
  positions?: Array<{ name: string; on_hand: number }>;
  forecast?: number;
  shortage?: number;
};
const stages = [
  "Intake",
  "Forecast",
  "Allocate",
  "Approve",
  "Reserve",
  "Dispatch",
  "Receive",
];

export function JudgeDemo() {
  const [state, setState] = useState<DemoState>({ seeded: false }),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [ideal, setIdeal] = useState(200);
  async function load() {
    setState(await apiJson<DemoState>("/api/demo"));
  }
  useEffect(() => {
    void load().catch(() => {});
  }, []);
  async function action(name: string, extra: Record<string, unknown> = {}) {
    setBusy(name);
    setError("");
    try {
      setState(
        await apiJson<DemoState>("/api/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: name, ...extra }),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Demo action failed");
    } finally {
      setBusy("");
    }
  }
  if (!state.seeded)
    return (
      <section className="demo-empty panel">
        <p className="eyebrow">Deterministic 72-hour scenario</p>
        <h2>Run the judge demo</h2>
        <p>
          Creates Fremont, Oakland, Bay Fresh, 30 days of dispatch history, a
          flood forecast, bounded requests, transport capacity, and four human
          approval checkpoints.
        </p>
        <button
          className="button primary demo-primary"
          disabled={!!busy}
          onClick={() => void action("seed")}
        >
          {busy ? "Building scenario…" : "Initialize live demo"}
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    );
  const p = state.proposal!,
    approved =
      state.approvals?.filter((x) => x.status === "approved").length || 0,
    received = state.shipment?.status === "received",
    dispatched = ["dispatched", "received"].includes(
      state.shipment?.status || "",
    ),
    reserved = Boolean(state.shipment),
    active = received ? 7 : dispatched ? 6 : reserved ? 5 : approved ? 4 : 3;
  return (
    <div className="judge-demo">
      <section className="demo-hero">
        <div>
          <p className="eyebrow">Judge mode · real Neon transactions</p>
          <h2>Fremont flood response</h2>
          <p>
            One traceable run from intake through receipt. Every commitment
            stops for a human.
          </p>
        </div>
        <div className="demo-hero-actions">
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() => void action("seed")}
          >
            Reset scenario
          </button>
          <button
            className="button primary"
            disabled={!!busy}
            onClick={() => void action("run_all")}
          >
            Run full walkthrough
          </button>
        </div>
      </section>
      <div className="demo-stagebar">
        {stages.map((label, index) => (
          <div
            className={
              index < active ? "done" : index === active ? "active" : ""
            }
            key={label}
          >
            <span>{index < active ? "✓" : index + 1}</span>
            <b>{label}</b>
          </div>
        ))}
      </div>
      <section className="demo-kpis">
        <div>
          <small>72H FORECAST</small>
          <strong>{state.forecast}</strong>
          <span>cases</span>
        </div>
        <div>
          <small>AVAILABLE</small>
          <strong>{Number(p.calculation.available)}</strong>
          <span>Fremont</span>
        </div>
        <div className={state.shortage === 0 ? "resolved" : "alert"}>
          <small>SHORTAGE</small>
          <strong>{state.shortage}</strong>
          <span>{state.shortage === 0 ? "resolved" : "cases"}</span>
        </div>
        <div>
          <small>LOGISTICS CAP</small>
          <strong>{Number(p.calculation.logisticsCap)}</strong>
          <span>cases</span>
        </div>
      </section>
      <div className="demo-grid">
        <section className="panel request-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Bounded request</p>
              <h2>Demand contract</h2>
            </div>
            <span className={`demo-status ${p.status}`}>
              {p.status.replaceAll("_", " ")}
            </span>
          </div>
          <div className="request-bounds">
            <div>
              <small>Minimum</small>
              <strong>{p.minimum}</strong>
              <span>Do not proceed below</span>
            </div>
            <div className="ideal">
              <small>Ideal</small>
              <input
                aria-label="Ideal request quantity"
                type="number"
                min={p.minimum}
                max={p.maximum}
                value={ideal}
                onChange={(event) => setIdeal(Number(event.target.value))}
              />
              <button
                disabled={!!busy || ideal === p.ideal}
                onClick={() => void action("revise", { quantity: ideal })}
              >
                Apply + reapprove
              </button>
            </div>
            <div>
              <small>Maximum</small>
              <strong>{p.maximum}</strong>
              <span>Never exceed</span>
            </div>
          </div>
          <div className="forecast-equation">
            <span>Forecast {state.forecast}</span>
            <b>−</b>
            <span>Available {p.calculation.available}</span>
            <b>=</b>
            <strong>Shortage {state.shortage}</strong>
          </div>
        </section>
        <section className="panel allocation-card">
          <p className="eyebrow">ATLAS allocation</p>
          <h2>{p.recommended} cases recommended</h2>
          <div className="allocation-stack">
            {p.plan.allocations.map((allocation: any) => (
              <div
                key={allocation.sourceId}
                style={{
                  width: `${(allocation.quantity / p.recommended) * 100}%`,
                }}
              >
                <b>{allocation.sourceName}</b>
                <span>{allocation.quantity} cases allocated</span>
              </div>
            ))}
          </div>
          <p className="allocation-rule">
            Logistics caps the combined load at {p.calculation.logisticsCap}.
            ATLAS recomputes the donor/vendor mix whenever the bounded request
            changes.
          </p>
        </section>
      </div>
      <section className="panel approval-board">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Four-party authority</p>
            <h2>{approved}/4 commitments approved</h2>
          </div>
          {approved < 4 && (
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() => void action("approve_next")}
            >
              {busy === "approve_next"
                ? "Recording…"
                : "Approve next commitment"}
            </button>
          )}
        </div>
        <div className="approval-grid">
          {state.approvals?.map((approval, index) => (
            <article className={approval.status} key={approval.id}>
              <span>0{index + 1}</span>
              <div>
                <small>{approval.role.replaceAll("_", " ")}</small>
                <strong>{approval.organization}</strong>
              </div>
              <b>{approval.status}</b>
            </article>
          ))}
        </div>
        <p className="approval-note">
          Any quantity or allocation change creates a new proposal version and
          invalidates these approvals.
        </p>
      </section>
      <div className="demo-grid lifecycle-grid">
        <section className="panel">
          <p className="eyebrow">Reservation + shipment</p>
          <h2>
            {state.shipment
              ? `Shipment ${state.shipment.status}`
              : "Awaiting approvals"}
          </h2>
          <div className="reservation-list">
            {state.reservations?.map((r) => (
              <div key={r.source}>
                <strong>{r.source}</strong>
                <span>{r.quantity} cases</span>
                <b>{r.status}</b>
              </div>
            ))}
          </div>
          <div className="lifecycle-actions">
            <button
              className="button secondary"
              disabled={!reserved || dispatched || !!busy}
              onClick={() => void action("dispatch")}
            >
              Dispatch shipment
            </button>
            <button
              className="button primary"
              disabled={!dispatched || received || !!busy}
              onClick={() => void action("receive")}
            >
              Confirm receipt
            </button>
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Ledger positions</p>
          <h2>Both sites reconcile</h2>
          <div className="position-list">
            {state.positions?.map((position) => (
              <div key={position.name}>
                <span>{position.name}</span>
                <strong>{Number(position.on_hand)} cases</strong>
              </div>
            ))}
          </div>
          <div
            className={`shortage-result ${state.shortage === 0 ? "resolved" : ""}`}
          >
            <small>Fremont shortage after receipt</small>
            <strong>{state.shortage}</strong>
          </div>
        </section>
      </div>
      {error && <p className="error demo-error">{error}</p>}
    </div>
  );
}
