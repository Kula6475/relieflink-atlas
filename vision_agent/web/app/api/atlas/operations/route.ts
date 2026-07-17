import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { foodBankContext } from "../../../../lib/food-bank";
import { sql, withTransaction } from "../../../../lib/db";
import {
  fetchDisruptions,
  fetchOptimalRoute,
  forecastDemand,
  haversine,
  networkBalanceTarget,
  severityMultiplier,
  type Site,
} from "../../../../lib/atlas/operational";
import {
  boundedOffer,
  explainNegotiation,
  verifiedSurplus,
} from "../../../../lib/atlas/negotiation";
export const maxDuration = 45;
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    const context = await foodBankContext(session),
      runs =
        await sql()`SELECT r.*,to_jsonb(c) consignment,COALESCE(json_agg(s ORDER BY s.sequence) FILTER(WHERE s.id IS NOT NULL),'[]') steps FROM operational_runs r LEFT JOIN operational_steps s ON s.operational_run_id=r.id LEFT JOIN operational_consignments c ON c.operational_run_id=r.id WHERE r.site_id=${context.siteId} GROUP BY r.id,c.id ORDER BY r.created_at DESC LIMIT 10`;
    return NextResponse.json({
      context,
      runs,
      services: {
        openai: Boolean(process.env.OPENAI_API_KEY),
        weather: true,
        fema: true,
        database: Boolean(process.env.DATABASE_URL),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load ATLAS",
      },
      { status: 400 },
    );
  }
}
export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    const requestBody = await request.json().catch(() => ({}));
    const requestedCategory =
      typeof requestBody?.category === "string" && requestBody.category.trim()
        ? requestBody.category.trim()
        : null;
    const parLevel = Math.max(
      0,
      Math.min(100000, Number(requestBody?.parLevel ?? 10) || 10),
    );
    const context = await foodBankContext(session);
    const siteRows =
        await sql()`SELECT s.id,s.name,s.county,s.state,s.latitude,s.longitude,s.safety_stock_policy,a.name agent_name FROM sites s LEFT JOIN agents a ON a.site_id=s.id AND a.agent_type='site' AND a.active=true WHERE s.id=${context.siteId}`,
      site = siteRows[0] as unknown as Site;
    if (!site) throw new Error("Site not found");
    const [disruptions, inventory, history, network] = await Promise.all([
      fetchDisruptions(site),
      sql()`SELECT category,sum(quantity)::float quantity FROM inventory_items WHERE site_id=${context.siteId} AND condition='good' GROUP BY category`,
      sql()`SELECT category,date_trunc('day',created_at) AS demand_day,sum(quantity)::float quantity FROM inventory_transactions WHERE site_id=${context.siteId} AND direction='out' AND approval_status='approved' AND created_at>now()-interval '30 days' GROUP BY category,date_trunc('day',created_at) ORDER BY demand_day`,
      sql()`SELECT s.id,s.name,s.county,s.state,s.latitude,s.longitude,s.organization_id,s.safety_stock_policy,i.category,sum(i.quantity)::float quantity,COALESCE(r.reserved,0)::float reserved,a.name agent_name FROM sites s JOIN inventory_items i ON i.site_id=s.id AND i.condition='good' LEFT JOIN agents a ON a.site_id=s.id AND a.agent_type='site' AND a.active=true LEFT JOIN(SELECT site_id,category,sum(quantity)::float reserved FROM(SELECT site_id,category,quantity FROM inventory_reservations WHERE status IN('provisional','active') UNION ALL SELECT site_id,category,quantity FROM inventory_transactions WHERE direction='hold' AND approval_status='approved' AND source='atlas-interbank') commitments GROUP BY site_id,category)r ON r.site_id=s.id AND r.category=i.category WHERE s.id<>${context.siteId} GROUP BY s.id,i.category,r.reserved,a.name`,
    ]);
    const multiplier = severityMultiplier(disruptions.events),
      categories = new Set([
        ...inventory.map((x) => String(x.category)),
        ...history.map((x) => String(x.category)),
        ...Object.keys(
          (siteRows[0].safety_stock_policy as Record<string, number>) || {},
        ),
      ]);
    const forecasts = [...categories]
      .map((category) => {
        const h = history
            .filter((x) => x.category === category)
            .map((x) => Number(x.quantity)),
          model = forecastDemand(h, multiplier),
          onHand = Number(
            inventory.find((x) => x.category === category)?.quantity || 0,
          ),
          safetyStock = Number(
            ((siteRows[0].safety_stock_policy as Record<string, number>) || {})[
              category
            ] || 0,
          ),
          peerInventory = network
            .filter(
              (row) =>
                String(row.category).trim().toLowerCase() ===
                category.trim().toLowerCase(),
            )
            .map((row) => Number(row.quantity)),
          balanceTarget = networkBalanceTarget(onHand, peerInventory),
          target = Math.max(
            model.forecast,
            safetyStock,
            balanceTarget,
            parLevel,
          );
        return {
          category,
          onHand,
          safetyStock,
          target,
          networkBalanceTarget: balanceTarget,
          ...model,
          shortage: Math.max(0, target - onHand),
        };
      })
      .sort((a, b) => b.shortage - a.shortage);
    const need = (requestedCategory
      ? forecasts.find(
          (forecast) =>
            forecast.category.trim().toLowerCase() ===
            requestedCategory.toLowerCase(),
        )
      : forecasts[0]) || {
      category: "Unspecified",
      onHand: 0,
      baseline: 0,
      trend: 0,
      forecast: 0,
      confidence: 0.35,
      method: "no inventory history",
      shortage: 0,
      target: parLevel,
      safetyStock: 0,
      networkBalanceTarget: 0,
    };
    const candidates = network
      .filter(
        (x) =>
          String(x.category).trim().toLowerCase() ===
          need.category.trim().toLowerCase(),
      )
      .map((x) => {
        const source = {
          id: String(x.id),
          name: String(x.name),
          county: String(x.county),
          state: String(x.state),
          latitude: Number(x.latitude),
          longitude: Number(x.longitude),
        };
        const safetyStock = Math.max(
            parLevel,
            Number(
              ((x.safety_stock_policy as Record<string, number>) || {})[
                need.category
              ] || 0,
            ),
          ),
          reserved = Number(x.reserved || 0),
          available = verifiedSurplus(
            Number(x.quantity),
            safetyStock,
            reserved,
          );
        return {
          ...source,
          organizationId: String(x.organization_id),
          agentName: String(x.agent_name || `${x.name} Inventory Agent`),
          available,
          safetyStock,
          reserved,
          distance: haversine(source, site),
        };
      })
      .filter((x) => x.available > 0)
      .sort((a, b) => a.distance - b.distance);
    const source = candidates[0] || null;
    const requested = need.shortage;
    const counter = source ? boundedOffer(requested, source.available) : 0;
    const accepted = counter > 0;
    const route =
      source && counter ? await fetchOptimalRoute(source, site) : null;
    const transport =
      source && counter && route
        ? {
            fromSiteId: source.id,
            fromSite: source.name,
            from: { latitude: source.latitude, longitude: source.longitude },
            to: { latitude: site.latitude, longitude: site.longitude },
            toSite: site.name,
            category: need.category,
            quantity: counter,
            distanceMiles: route.distanceMiles,
            estimatedMinutes: route.estimatedMinutes,
            routeSource: route.source,
            routeCoordinates: route.coordinates,
            capacityStatus: "requires logistics confirmation",
          }
        : null;
    const requestingAgent = String(
      siteRows[0].agent_name || `${site.name} Inventory Agent`,
    );
    const negotiation = source
      ? await explainNegotiation({
          requestingSite: site.name,
          requestingAgent,
          donorSite: source.name,
          donorAgent: source.agentName,
          category: need.category,
          requested,
          offered: counter,
          verifiedSurplus: source.available,
          safetyStock: source.safetyStock,
          distanceMiles: Number(source.distance.toFixed(1)),
        })
      : {
          mode: "rules" as const,
          explanation:
            "No partner branch has verified surplus above safety stock for this category.",
        };
    const output = await withTransaction(async (c) => {
      const run = (
        await c.query(
          "INSERT INTO operational_runs(site_id,organization_id,trigger_type,status,initiated_by) VALUES($1,$2,'live_network_review',$3,$4) RETURNING *",
          [
            context.siteId,
            context.organizationId,
            requested && accepted ? "awaiting_human" : "completed",
            session.userId,
          ],
        )
      ).rows[0];
      const steps = [
        {
          agent: "Inventory Agent",
          input: { siteId: site.id, agentName: requestingAgent },
          output: { categories: forecasts },
          explanation: `${requestingAgent} found ${need.category} at ${need.onHand} units against a par target of ${need.target}.`,
          approval: false,
        },
        {
          agent: "Disruption + Demand Agent",
          input: {
            sources: ["api.weather.gov", "OpenFEMA"],
            events: disruptions.events.length,
          },
          output: {
            events: disruptions.events,
            multiplier,
            forecast: need,
            sources: disruptions.sources,
          },
          explanation: `Ran ${need.method}; live disruption multiplier is ${multiplier.toFixed(2)}×.`,
          approval: false,
        },
        {
          agent: "Site Negotiation Agent",
          input: { requested, category: need.category },
          output: {
            source,
            requested,
            counteroffer: counter,
            acceptedByPolicy: accepted,
            messages: source
              ? [
                  {
                    from: requestingAgent,
                    to: source.agentName,
                    text: `Requesting ${requested} ${need.category} based on a verified shortage target of ${need.target}.`,
                  },
                  {
                    from: source.agentName,
                    to: requestingAgent,
                    text: `I can offer ${counter} ${need.category}. My ledger shows ${source.available} available above safety stock and existing commitments.`,
                  },
                ]
              : [],
          },
          explanation: source
            ? negotiation.explanation
            : "No eligible partner surplus was found.",
          approval: Boolean(counter),
        },
        {
          agent: "Transport Logistics Agent",
          input: { source: source?.id, destination: site.id },
          output: transport || {
            feasible: false,
            reason: "No negotiated load",
          },
          explanation: transport
            ? `${transport.routeSource} selected: ${transport.distanceMiles} miles and ${transport.estimatedMinutes} minutes. A logistics human must confirm vehicle capacity.`
            : "No route was proposed.",
          approval: Boolean(transport),
        },
        {
          agent: "ATLAS Orchestrator",
          input: { precedingSteps: 4 },
          output: {
            recommendation: transport
              ? "Review coordinated transfer"
              : "No transfer recommended",
            requested,
            counteroffer: counter,
            humanDecisionRequired: Boolean(transport),
          },
          explanation:
            "Combined inventory, disruption, demand, negotiation, and logistics evidence without executing a commitment.",
          approval: Boolean(transport),
        },
      ];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await c.query(
          "INSERT INTO operational_steps(operational_run_id,agent_name,sequence,status,input,output,explanation,requires_human_approval) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            run.id,
            s.agent,
            i + 1,
            s.approval ? "awaiting_human" : "completed",
            s.input,
            s.output,
            s.explanation,
            s.approval,
          ],
        );
      }
      for (const e of disruptions.events)
        await c.query(
          "INSERT INTO disruption_events(site_id,source,external_id,event_type,severity,headline,starts_at,ends_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(site_id,source,external_id) DO UPDATE SET severity=EXCLUDED.severity,headline=EXCLUDED.headline,payload=EXCLUDED.payload,fetched_at=now()",
          [
            site.id,
            e.source,
            e.id,
            e.type,
            e.severity,
            e.headline,
            e.startsAt || null,
            e.endsAt || null,
            e.payload,
          ],
        );
      if (transport)
        await c.query(
          "INSERT INTO transport_plans(operational_run_id,from_site_id,to_site_id,category,quantity,distance_miles,estimated_minutes) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            run.id,
            transport.fromSiteId,
            site.id,
            transport.category,
            transport.quantity,
            transport.distanceMiles,
            transport.estimatedMinutes,
          ],
        );
      if (transport && source)
        await c.query(
          "INSERT INTO operational_consignments(operational_run_id,source_site_id,destination_site_id,category,requested_quantity,offered_quantity,negotiation_mode,negotiation_explanation) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            run.id,
            source.id,
            site.id,
            need.category,
            requested,
            counter,
            negotiation.mode,
            negotiation.explanation,
          ],
        );
      await c.query(
        "UPDATE operational_runs SET summary=$2,completed_at=now() WHERE id=$1",
        [
          run.id,
          {
            forecast: need,
            events: disruptions.events.length,
            requested,
            counteroffer: counter,
            transport,
            negotiationMode: negotiation.mode,
          },
        ],
      );
      return {
        ...run,
        steps,
        summary: {
          forecast: need,
          events: disruptions.events.length,
          requested,
          counteroffer: counter,
          transport,
          negotiationMode: negotiation.mode,
        },
      };
    });
    return NextResponse.json({ run: output }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ATLAS run failed" },
      { status: 500 },
    );
  }
}
