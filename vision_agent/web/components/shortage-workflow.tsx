"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { apiJson } from "./client-api";

const ReallocationMap = dynamic(() => import("./reallocation-map"), {
  ssr: false,
});

type Step = {
  agent: string;
  explanation: string;
  output: Record<string, any>;
};
type Run = {
  id: string;
  status: string;
  steps: Step[];
  summary: Record<string, any>;
};

export function ShortageWorkflow({
  item,
  parLevel,
  onClose,
  onComplete,
}: {
  item: { productName: string; category: string; quantity: number };
  parLevel: number;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<"reserved" | "rejected" | null>(
    null,
  );
  const shortage = Math.max(0, parLevel - item.quantity);
  const negotiation = run?.steps.find((step) =>
    step.agent.includes("Negotiation"),
  );
  const logistics = run?.steps.find((step) => step.agent.includes("Transport"));
  const events =
    run?.steps.find((step) => step.agent.includes("Disruption"))?.output
      ?.events || [];
  const messages = negotiation?.output?.messages || [];
  const source = negotiation?.output?.source;
  const routeCoordinates = logistics?.output?.routeCoordinates || [];
  const progress = useMemo(
    () => [
      { label: "Shortage", done: true },
      { label: "Partner", done: Boolean(run) },
      { label: "Negotiate", done: Boolean(negotiation?.output?.counteroffer) },
      { label: "Route", done: routeCoordinates.length > 1 },
      { label: "Approve", done: decision === "reserved" },
    ],
    [run, negotiation, routeCoordinates.length, decision],
  );

  async function findPartner() {
    setBusy(true);
    setError("");
    try {
      const response = await apiJson<{ run: Run }>("/api/atlas/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: item.category, parLevel }),
      });
      setRun(response.run);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Network review failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function decide(value: "approved" | "rejected") {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/atlas/operations/${run.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: value,
          note: "Decision recorded through guided shortage workflow",
        }),
      });
      setDecision(value === "approved" ? "reserved" : "rejected");
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shortage-overlay" role="dialog" aria-modal="true">
      <section className="shortage-wizard">
        <header>
          <div>
            <p className="eyebrow">Inventory review</p>
            <h2>{item.category} is below par</h2>
            <p>
              {item.productName} now has <strong>{item.quantity}</strong> units.
              Your par level is <strong>{parLevel}</strong>.
            </p>
          </div>
          <button aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <ol className="simple-flowchart">
          {progress.map((step, index) => (
            <li className={step.done ? "done" : ""} key={step.label}>
              <span>{step.done ? "✓" : index + 1}</span>
              <strong>{step.label}</strong>
            </li>
          ))}
        </ol>

        {!run && (
          <div className="shortage-callout">
            <div>
              <strong>Minimum immediate gap: {shortage} units</strong>
              <p>
                ATLAS can check nearby registered food banks, protect their par
                stock, and request only verified surplus.
              </p>
            </div>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void findPartner()}
            >
              {busy ? "Checking nearby sites…" : "Find a nearby food bank"}
            </button>
          </div>
        )}

        {run && !source && (
          <div className="warning">
            No nearby food bank currently has verified {item.category} surplus
            above its par level and existing commitments.
          </div>
        )}

        {source && (
          <div className="guided-result">
            <section>
              <p className="eyebrow">Recommended partner</p>
              <h3>{source.name}</h3>
              <dl>
                <div>
                  <dt>Requested</dt>
                  <dd>{negotiation?.output?.requested}</dd>
                </div>
                <div>
                  <dt>Partner offer</dt>
                  <dd>{negotiation?.output?.counteroffer}</dd>
                </div>
                <div>
                  <dt>Protected at partner</dt>
                  <dd>{source.safetyStock} minimum</dd>
                </div>
                <div>
                  <dt>Distance</dt>
                  <dd>{logistics?.output?.distanceMiles} miles</dd>
                </div>
              </dl>
            </section>

            <section className="agent-transcript">
              <p className="eyebrow">Agent exchange</p>
              {messages.map((message: any, index: number) => (
                <div key={index}>
                  <strong>{message.from}</strong>
                  <span>to {message.to}</span>
                  <p>{message.text}</p>
                </div>
              ))}
              {!messages.length && <p>No counteroffer was produced.</p>}
            </section>

            {events.length > 0 && (
              <section className="guided-alerts">
                <p className="eyebrow">Live disruption evidence</p>
                {events.slice(0, 3).map((event: any) => (
                  <p key={`${event.source}-${event.id}`}>
                    <strong>{event.source}</strong> · {event.headline}
                  </p>
                ))}
              </section>
            )}

            {routeCoordinates.length > 1 && (
              <section className="guided-route">
                <div>
                  <p className="eyebrow">Transfer route</p>
                  <strong>
                    {logistics?.output?.distanceMiles} miles ·{" "}
                    {logistics?.output?.estimatedMinutes} minutes
                  </strong>
                </div>
                <ReallocationMap
                  coordinates={routeCoordinates}
                  from={source.name}
                  to={logistics?.output?.toSite || "Your food bank"}
                />
              </section>
            )}

            <section className="approval-stop">
              <div>
                <p className="eyebrow">Human decision</p>
                <strong>
                  {decision === "reserved"
                    ? "Inventory reserved. No shipment was dispatched automatically."
                    : decision === "rejected"
                      ? "Request rejected. No inventory was reserved."
                      : `Approve a ${negotiation?.output?.counteroffer}-unit consignment from ${source.name}?`}
                </strong>
              </div>
              {!decision && (
                <div>
                  <button
                    disabled={busy}
                    onClick={() => void decide("rejected")}
                  >
                    Reject
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void decide("approved")}
                  >
                    Approve reservation
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {error && <p className="error">{error}</p>}
        <footer>
          <button className="button ghost" onClick={() => window.print()}>
            Print review
          </button>
          <button className="button ghost" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
