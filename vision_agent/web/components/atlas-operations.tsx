"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { apiJson } from "./client-api";
const ReallocationMap = dynamic(() => import("./reallocation-map"), {
  ssr: false,
});

type Step = {
  agent: string;
  agent_name?: string;
  sequence?: number;
  status: string;
  explanation: string;
  output: Record<string, any>;
  requires_human_approval?: boolean;
  approval?: boolean;
};
type Consignment = {
  source_site_id: string;
  destination_site_id: string;
  category: string;
  requested_quantity: string;
  offered_quantity: string;
  status: string;
  negotiation_mode: string;
};
type Run = {
  id: string;
  status: string;
  created_at?: string;
  steps: Step[];
  consignment?: Consignment | null;
};
type RunsResponse = {
  runs: Run[];
  services: {
    openai: boolean;
    weather: boolean;
    fema: boolean;
    database: boolean;
  };
};

export function AtlasOperations({
  label = "Open live coordination",
  launchOnOpen = false,
  onOpen,
}: {
  label?: string;
  launchOnOpen?: boolean;
  onOpen?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [runs, setRuns] = useState<Run[]>([]),
    [services, setServices] = useState<RunsResponse["services"]>({
      openai: false,
      weather: true,
      fema: true,
      database: true,
    }),
    [error, setError] = useState("");
  async function load() {
    const body = await apiJson<RunsResponse>("/api/atlas/operations");
    setRuns(body.runs);
    setServices(body.services);
  }
  async function launch() {
    setBusy(true);
    setError("");
    try {
      const body = await apiJson<{ run: Run }>("/api/atlas/operations", {
        method: "POST",
      });
      if (body.run) await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }
  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/atlas/operations/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          note: "Decision recorded in ATLAS command center",
        }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }
  async function show() {
    setOpen(true);
    setError("");
    try {
      await Promise.all([load(), onOpen?.()]);
      if (launchOnOpen) await launch();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Command center unavailable",
      );
    }
  }
  return (
    <>
      <button
        className="button secondary atlas-launch"
        onClick={() => void show()}
      >
        <span>ATLAS / LIVE OPS</span>
        <strong>{label}</strong>
        <b>→</b>
      </button>
      {open && (
        <div className="atlas-overlay">
          <div className="atlas-modal">
            <header>
              <div>
                <p className="eyebrow">Live multi-agent orchestration</p>
                <h2>ATLAS command center</h2>
                <p>
                  Site agents share verified inventory, negotiate bounded
                  branch-to-branch consignments, and stop for your approval.
                </p>
              </div>
              <button
                className="modal-close"
                aria-label="Close command center"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="agent-roster">
              {[
                "Inventory",
                "Disruption + demand",
                "Site negotiation",
                "Transport logistics",
                "ATLAS orchestration",
              ].map((name, index) => (
                <div key={name}>
                  <span>0{index + 1}</span>
                  <strong>{name}</strong>
                  <small>
                    {index === 4 ? "Coordinates the team" : "Specialist agent"}
                  </small>
                </div>
              ))}
            </div>
            <div className="atlas-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void launch()}
              >
                {busy ? "Agents working…" : "Run live network review"}
              </button>
              <span>
                Ledger + weather.gov + OpenFEMA + demand history + partner
                inventory + route math
              </span>
            </div>
            <div className="atlas-service-strip">
              <span className={services.database ? "live" : ""}>
                Database {services.database ? "live" : "missing"}
              </span>
              <span className={services.weather ? "live" : ""}>
                Weather.gov live
              </span>
              <span className={services.fema ? "live" : ""}>OpenFEMA live</span>
              <span className={services.openai ? "live" : ""}>
                OpenAI {services.openai ? "connected" : "rules fallback"}
              </span>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="run-list">
              {runs.map((run) => {
                const disruption = run.steps.find((step) =>
                  (step.agent_name || step.agent)
                    .toLowerCase()
                    .includes("disruption"),
                );
                const events = Array.isArray(disruption?.output?.events)
                  ? disruption.output.events
                  : [];
                const logistics = run.steps.find((step) =>
                  (step.agent_name || step.agent)
                    .toLowerCase()
                    .includes("transport"),
                );
                const routeCoordinates = Array.isArray(
                  logistics?.output?.routeCoordinates,
                )
                  ? logistics.output.routeCoordinates
                  : [];
                return (
                  <article key={run.id}>
                    <div className="run-head">
                      <div>
                        <strong>
                          {new Date(
                            run.created_at || Date.now(),
                          ).toLocaleString()}
                        </strong>
                        <span className={`run-status ${run.status}`}>
                          {run.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      {run.status === "awaiting_human" && (
                        <div>
                          <button
                            onClick={() => void decide(run.id, "rejected")}
                          >
                            Reject
                          </button>
                          <button
                            className="approve"
                            onClick={() => void decide(run.id, "approved")}
                          >
                            Approve plan
                          </button>
                        </div>
                      )}
                    </div>
                    {run.consignment && (
                      <div className="consignment-summary">
                        <div>
                          <small>Category</small>
                          <strong>{run.consignment.category}</strong>
                        </div>
                        <div>
                          <small>Requested</small>
                          <strong>
                            {Number(
                              run.consignment.requested_quantity,
                            ).toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          <small>Partner offer</small>
                          <strong>
                            {Number(
                              run.consignment.offered_quantity,
                            ).toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          <small>Negotiation</small>
                          <strong>
                            {run.consignment.negotiation_mode === "openai"
                              ? "AI explained"
                              : "Rules verified"}
                          </strong>
                        </div>
                      </div>
                    )}
                    {events.length > 0 && (
                      <div className="disruption-list">
                        <strong>Active disruption evidence</strong>
                        {events.slice(0, 3).map((event: any) => (
                          <div key={`${event.source}-${event.id}`}>
                            <span>{event.source}</span>
                            <p>{event.headline}</p>
                            <small>{event.severity}</small>
                          </div>
                        ))}
                      </div>
                    )}
                    {routeCoordinates.length > 1 && (
                      <div className="route-review">
                        <div>
                          <strong>Recommended transfer route</strong>
                          <span>
                            {logistics?.output?.distanceMiles} miles ·{" "}
                            {logistics?.output?.estimatedMinutes} minutes ·{" "}
                            {logistics?.output?.routeSource}
                          </span>
                        </div>
                        <ReallocationMap
                          coordinates={routeCoordinates}
                          from={String(
                            logistics?.output?.fromSite || "Source branch",
                          )}
                          to={String(
                            logistics?.output?.toSite || "Destination branch",
                          )}
                        />
                      </div>
                    )}
                    <div className="agent-flow">
                      {run.steps.map((step, index) => (
                        <div
                          className="flow-step"
                          key={`${step.agent_name || step.agent}-${index}`}
                        >
                          <span>{index + 1}</span>
                          <div>
                            <small>{step.agent_name || step.agent}</small>
                            <strong>{step.explanation}</strong>
                            {step.output?.counteroffer !== undefined && (
                              <p>
                                Requested {step.output.requested} → counteroffer{" "}
                                {step.output.counteroffer}
                              </p>
                            )}
                            {Array.isArray(step.output?.messages) &&
                              step.output.messages.map(
                                (message: any, messageIndex: number) => (
                                  <div
                                    className="agent-message"
                                    key={messageIndex}
                                  >
                                    <small>
                                      {message.from} → {message.to}
                                    </small>
                                    <p>{message.text}</p>
                                  </div>
                                ),
                              )}
                            {step.requires_human_approval || step.approval ? (
                              <em>Human approval boundary</em>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
              {!runs.length && !busy && (
                <div className="empty-state">
                  <h3>No orchestration runs yet</h3>
                  <p>
                    Start a live review to see evidence move through the supply
                    chain.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
