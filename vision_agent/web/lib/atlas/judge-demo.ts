import type { PoolClient } from "@neondatabase/serverless";
import type { Session } from "../auth";
import { sql, withTransaction } from "../db";
import {
  allocateDemoRequest,
  calculateShortage,
  nextShipmentStatus,
} from "../demo-engine";

const KEY = "judge-demo-v1",
  CATEGORY = "canned_goods",
  PRODUCT = "Canned vegetables";
const names = {
  fremont: "Fremont Food Bank",
  oakland: "Oakland Food Bank",
  vendor: "Bay Fresh Foods",
  logistics: "Bay Relief Logistics",
};

async function organization(client: PoolClient, name: string, type: string) {
  const demoKey = `${KEY}:${name.toLowerCase().replaceAll(" ", "-")}`;
  const found = await client.query(
    "SELECT * FROM organizations WHERE demo_key=$1",
    [demoKey],
  );
  if (found.rows[0]) return found.rows[0];
  return (
    await client.query(
      "INSERT INTO organizations(name,organization_type,demo_key) VALUES($1,$2,$3) RETURNING *",
      [name, type, demoKey],
    )
  ).rows[0];
}
async function site(
  client: PoolClient,
  organizationId: string,
  name: string,
  county: string,
  latitude: number,
  longitude: number,
  safety = 0,
) {
  const found = await client.query(
    "SELECT * FROM sites WHERE organization_id=$1 AND name=$2 ORDER BY created_at LIMIT 1",
    [organizationId, name],
  );
  if (found.rows[0]) {
    await client.query(
      "UPDATE sites SET county=$2,state='CA',latitude=$3,longitude=$4,address=$5,safety_stock_policy=$6 WHERE id=$1",
      [
        found.rows[0].id,
        county,
        latitude,
        longitude,
        `${name}, ${county} County, CA`,
        { [CATEGORY]: safety },
      ],
    );
    return found.rows[0];
  }
  return (
    await client.query(
      "INSERT INTO sites(organization_id,name,county,state,latitude,longitude,address,safety_stock_policy) VALUES($1,$2,$3,'CA',$4,$5,$6,$7) RETURNING *",
      [
        organizationId,
        name,
        county,
        latitude,
        longitude,
        `${name}, ${county} County, CA`,
        { [CATEGORY]: safety },
      ],
    )
  ).rows[0];
}
async function membership(
  client: PoolClient,
  organizationId: string,
  userId: string,
  role: string,
  siteId: string | null,
) {
  const found = await client.query(
    "SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND role=$3 AND site_id IS NOT DISTINCT FROM $4",
    [organizationId, userId, role, siteId],
  );
  if (!found.rowCount)
    await client.query(
      "INSERT INTO organization_memberships(organization_id,user_id,role,site_id) VALUES($1,$2,$3,$4)",
      [organizationId, userId, role, siteId],
    );
}
async function item(
  client: PoolClient,
  input: {
    organizationId: string;
    siteId: string;
    quantity: number;
    userId: string;
  },
) {
  const found = await client.query(
    "SELECT id FROM inventory_items WHERE site_id=$1 AND category=$2 AND source_name=$3 FOR UPDATE",
    [input.siteId, CATEGORY, KEY],
  );
  if (found.rows[0]) {
    await client.query(
      "UPDATE inventory_items SET quantity=$2,row_version=row_version+1,updated_by=$3,updated_at=now() WHERE id=$1",
      [found.rows[0].id, input.quantity, input.userId],
    );
    return found.rows[0].id;
  }
  return (
    await client.query(
      "INSERT INTO inventory_items(organization_id,site_id,product_name,brand,category,quantity,unit,warehouse_zone,bin_location,condition,source_name,notes,intake_method,created_by,updated_by) VALUES($1,$2,$3,'ReliefLink Demo',$4,$5,'cases','DEMO','A-01','good',$6,'Judge demo ledger mirror','manual',$7,$7) RETURNING id",
      [
        input.organizationId,
        input.siteId,
        PRODUCT,
        CATEGORY,
        input.quantity,
        KEY,
        input.userId,
      ],
    )
  ).rows[0].id;
}
async function transaction(
  client: PoolClient,
  input: {
    organizationId: string;
    siteId: string;
    itemId?: string;
    quantity: number;
    direction: "in" | "out" | "hold" | "release";
    type: string;
    key: string;
    userId: string;
    createdAt?: Date;
    proposalId?: string;
  },
) {
  await client.query(
    `INSERT INTO inventory_transactions(organization_id,site_id,inventory_item_id,category,product_name,quantity,unit,direction,transaction_type,source,operator_id,approval_status,reviewer_id,approved_at,transfer_proposal_id,idempotency_key,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,'cases',$7,$8,$9,$10,'approved',$10,now(),$11,$12,$13,$14) ON CONFLICT(idempotency_key) DO NOTHING`,
    [
      input.organizationId,
      input.siteId,
      input.itemId || null,
      CATEGORY,
      PRODUCT,
      input.quantity,
      input.direction,
      input.type,
      KEY,
      input.userId,
      input.proposalId || null,
      input.key,
      { demo: true },
      input.createdAt || new Date(),
    ],
  );
}

export async function seedJudgeDemo(session: Session) {
  return withTransaction(async (client) => {
    const org = {
      fremont: await organization(client, names.fremont, "food_bank"),
      oakland: await organization(client, names.oakland, "food_bank"),
      vendor: await organization(client, names.vendor, "vendor"),
      logistics: await organization(client, names.logistics, "logistics"),
    };
    const locations = {
      fremont: await site(
        client,
        org.fremont.id,
        names.fremont,
        "Alameda",
        37.5485,
        -121.9886,
      ),
      oakland: await site(
        client,
        org.oakland.id,
        names.oakland,
        "Alameda",
        37.8044,
        -122.2712,
        150,
      ),
    };
    await membership(
      client,
      org.fremont.id,
      session.userId,
      "administrator",
      locations.fremont.id,
    );
    await membership(
      client,
      org.oakland.id,
      session.userId,
      "reviewer",
      locations.oakland.id,
    );
    await membership(
      client,
      org.vendor.id,
      session.userId,
      "vendor_representative",
      null,
    );
    await membership(
      client,
      org.logistics.id,
      session.userId,
      "logistics_coordinator",
      null,
    );
    const old = await client.query(
      "SELECT p.id,n.id negotiation_id FROM transfer_proposals p JOIN negotiations n ON n.id=p.negotiation_id WHERE n.region=$1",
      [KEY],
    );
    for (const row of old.rows) {
      await client.query(
        "DELETE FROM shipment_events WHERE shipment_id IN(SELECT id FROM shipments WHERE transfer_proposal_id=$1)",
        [row.id],
      );
      await client.query(
        "DELETE FROM shipments WHERE transfer_proposal_id=$1",
        [row.id],
      );
      await client.query(
        "DELETE FROM inventory_reservations WHERE transfer_proposal_id=$1",
        [row.id],
      );
      await client.query(
        "DELETE FROM required_approvals WHERE transfer_proposal_id=$1",
        [row.id],
      );
      await client.query(
        "DELETE FROM proposal_participants WHERE transfer_proposal_id=$1",
        [row.id],
      );
      await client.query(
        "DELETE FROM inventory_transactions WHERE transfer_proposal_id=$1",
        [row.id],
      );
      await client.query("DELETE FROM transfer_proposals WHERE id=$1", [
        row.id,
      ]);
      await client.query("DELETE FROM agent_messages WHERE negotiation_id=$1", [
        row.negotiation_id,
      ]);
      await client.query("DELETE FROM negotiations WHERE id=$1", [
        row.negotiation_id,
      ]);
    }
    await client.query(
      "DELETE FROM inventory_transactions WHERE idempotency_key LIKE $1",
      [`${KEY}:%`],
    );
    await client.query("DELETE FROM demand_forecasts WHERE source=$1", [KEY]);
    await client.query(
      "DELETE FROM vendor_supply WHERE organization_id=$1 AND product_name=$2",
      [org.vendor.id, PRODUCT],
    );
    await client.query(
      "DELETE FROM transportation_capacity WHERE organization_id=$1 AND vehicle_reference=$2",
      [org.logistics.id, "DEMO-TRUCK-150"],
    );
    const fremontItem = await item(client, {
        organizationId: org.fremont.id,
        siteId: locations.fremont.id,
        quantity: 175,
        userId: session.userId,
      }),
      oaklandItem = await item(client, {
        organizationId: org.oakland.id,
        siteId: locations.oakland.id,
        quantity: 250,
        userId: session.userId,
      });
    await transaction(client, {
      organizationId: org.fremont.id,
      siteId: locations.fremont.id,
      itemId: fremontItem,
      quantity: 475,
      direction: "in",
      type: "intake",
      key: `${KEY}:fremont-opening`,
      userId: session.userId,
      createdAt: new Date(Date.now() - 31 * 86400000),
    });
    for (let day = 30; day >= 1; day--)
      await transaction(client, {
        organizationId: org.fremont.id,
        siteId: locations.fremont.id,
        itemId: fremontItem,
        quantity: 10,
        direction: "out",
        type: "dispatch",
        key: `${KEY}:history:${day}`,
        userId: session.userId,
        createdAt: new Date(Date.now() - day * 86400000),
      });
    await transaction(client, {
      organizationId: org.oakland.id,
      siteId: locations.oakland.id,
      itemId: oaklandItem,
      quantity: 150,
      direction: "in",
      type: "intake",
      key: `${KEY}:oakland-opening`,
      userId: session.userId,
      createdAt: new Date(Date.now() - 2 * 86400000),
    });
    await transaction(client, {
      organizationId: org.oakland.id,
      siteId: locations.oakland.id,
      itemId: oaklandItem,
      quantity: 100,
      direction: "in",
      type: "intake",
      key: `${KEY}:oakland-incoming-100`,
      userId: session.userId,
    });
    await client.query(
      "INSERT INTO demand_forecasts(site_id,category,baseline_demand,observed_recent_demand,weather_adjustment,forecast_demand,confidence,horizon_hours,components,source,valid_from,valid_until) VALUES($1,$2,250,300,1.3,325,.91,72,$3,$4,now(),now()+interval '72 hours')",
      [
        locations.fremont.id,
        CATEGORY,
        { scenario: "72-hour flood", historyDays: 30 },
        KEY,
      ],
    );
    const supply = (
      await client.query(
        "INSERT INTO vendor_supply(organization_id,category,product_name,available_quantity,unit,minimum_lot,pickup_start,pickup_end,status,published_by) VALUES($1,$2,$3,80,'cases',10,now(),now()+interval '72 hours','available',$4) RETURNING *",
        [org.vendor.id, CATEGORY, PRODUCT, session.userId],
      )
    ).rows[0];
    await client.query(
      "INSERT INTO transportation_capacity(organization_id,vehicle_reference,capacity_units,available_from,available_until,status,constraints) VALUES($1,'DEMO-TRUCK-150',150,now(),now()+interval '72 hours','available',$2)",
      [org.logistics.id, { scenario: KEY }],
    );
    const allocation = allocateDemoRequest({
      ideal: 200,
      minimum: 150,
      maximum: 220,
      donorOffer: 100,
      vendorOffer: 80,
      logisticsCap: 150,
    });
    const negotiation = (
      await client.query(
        "INSERT INTO negotiations(trigger_type,status,region,expires_at) VALUES('weather_alert','awaiting_approvals',$1,now()+interval '72 hours') RETURNING *",
        [KEY],
      )
    ).rows[0];
    const plan = {
      allocations: [
        {
          sourceId: locations.oakland.id,
          sourceType: "site",
          organizationId: org.oakland.id,
          sourceName: names.oakland,
          quantity: 100,
          distanceMiles: 27,
        },
        {
          sourceId: supply.id,
          sourceType: "vendor",
          organizationId: org.vendor.id,
          sourceName: names.vendor,
          quantity: 50,
          distanceMiles: 16,
        },
      ],
      explanation:
        "ATLAS respects the 150-case logistics cap: Oakland supplies 100 and Bay Fresh supplies 50.",
    };
    const proposal = (
      await client.query(
        "INSERT INTO transfer_proposals(negotiation_id,status,category,requested_quantity,minimum_quantity,maximum_quantity,optimizer_recommended_quantity,needed_by,calculation,plan,expires_at) VALUES($1,'awaiting_approvals',$2,200,150,220,$3,now()+interval '72 hours',$4,$5,now()+interval '72 hours') RETURNING *",
        [
          negotiation.id,
          CATEGORY,
          allocation.total,
          {
            forecast: 325,
            available: 175,
            shortage: 150,
            ideal: 200,
            minimum: 150,
            maximum: 220,
            donorOffer: 100,
            vendorOffer: 80,
            logisticsCap: 150,
            floodHorizonHours: 72,
          },
          plan,
        ],
      )
    ).rows[0];
    for (const participant of [
      [org.fremont.id, "receiver", { quantity: 150 }],
      [org.oakland.id, "donor", { quantity: 100 }],
      [org.vendor.id, "vendor", { quantity: 50 }],
      [org.logistics.id, "logistics", { capacity: 150 }],
    ])
      await client.query(
        "INSERT INTO proposal_participants(transfer_proposal_id,organization_id,participant_role,commitment) VALUES($1,$2,$3,$4)",
        [proposal.id, ...participant],
      );
    for (const approval of [
      [org.oakland.id, "site_reviewer"],
      [org.vendor.id, "vendor_representative"],
      [org.logistics.id, "logistics_coordinator"],
      [org.fremont.id, "administrator"],
    ])
      await client.query(
        "INSERT INTO required_approvals(transfer_proposal_id,organization_id,approval_role) VALUES($1,$2,$3)",
        [proposal.id, ...approval],
      );
    await client.query(
      "INSERT INTO disruption_events(site_id,source,external_id,event_type,severity,headline,starts_at,ends_at,payload) VALUES($1,'demo',$2,'Flood Warning','Severe','72-hour Fremont flood scenario',now(),now()+interval '72 hours',$3) ON CONFLICT(site_id,source,external_id) DO UPDATE SET fetched_at=now(),payload=EXCLUDED.payload",
      [locations.fremont.id, KEY, { demo: true, horizonHours: 72 }],
    );
    return { proposalId: proposal.id };
  });
}

export async function loadJudgeDemo() {
  const proposals =
    await sql()`SELECT p.*,n.region FROM transfer_proposals p JOIN negotiations n ON n.id=p.negotiation_id WHERE n.region=${KEY} ORDER BY p.created_at DESC LIMIT 1`;
  if (!proposals[0]) return { seeded: false };
  const p = proposals[0],
    approvals =
      await sql()`SELECT a.*,o.name organization_name FROM required_approvals a JOIN organizations o ON o.id=a.organization_id WHERE a.transfer_proposal_id=${p.id} ORDER BY a.created_at`,
    reservations =
      await sql()`SELECT * FROM inventory_reservations WHERE transfer_proposal_id=${p.id}`,
    shipments =
      await sql()`SELECT * FROM shipments WHERE transfer_proposal_id=${p.id}`,
    positions =
      await sql()`SELECT s.name,COALESCE(SUM(CASE WHEN t.direction='in' THEN t.quantity WHEN t.direction='out' THEN -t.quantity ELSE 0 END),0)::float on_hand FROM sites s JOIN organizations o ON o.id=s.organization_id LEFT JOIN inventory_transactions t ON t.site_id=s.id AND t.category=${CATEGORY} AND t.approval_status='approved' WHERE o.demo_key IN('judge-demo-v1:fremont-food-bank','judge-demo-v1:oakland-food-bank') GROUP BY s.id ORDER BY s.name`;
  const fremont = Number(
      positions.find((x) => x.name === names.fremont)?.on_hand || 0,
    ),
    forecast = Number((p.calculation as any).forecast || 325);
  return {
    seeded: true,
    proposal: {
      id: String(p.id),
      status: String(p.status),
      version: Number(p.version),
      ideal: Number(p.requested_quantity),
      minimum: Number(p.minimum_quantity),
      maximum: Number(p.maximum_quantity),
      recommended: Number(p.optimizer_recommended_quantity),
      calculation: p.calculation,
      plan: p.plan,
    },
    approvals: approvals.map((a) => ({
      id: String(a.id),
      organization: String(a.organization_name),
      role: String(a.approval_role),
      status: String(a.status),
    })),
    reservations: reservations.map((r) => ({
      source: r.site_id ? "Oakland" : "Bay Fresh",
      quantity: Number(r.quantity),
      status: String(r.status),
    })),
    shipment: shipments[0]
      ? {
          id: String(shipments[0].id),
          status: String(shipments[0].status),
          manifest: shipments[0].manifest,
        }
      : null,
    positions,
    forecast,
    shortage: calculateShortage(forecast, fremont),
  };
}

export async function reviseJudgeDemoQuantity(quantity: number) {
  return withTransaction(async (client) => {
    const proposal = (
      await client.query(
        "SELECT p.* FROM transfer_proposals p JOIN negotiations n ON n.id=p.negotiation_id WHERE n.region=$1 ORDER BY p.created_at DESC LIMIT 1 FOR UPDATE OF p",
        [KEY],
      )
    ).rows[0];
    if (!proposal) throw new Error("Initialize the demo first");
    if (["dispatched", "received"].includes(proposal.status))
      throw new Error("A dispatched transfer cannot be resized");
    const minimum = Number(proposal.minimum_quantity),
      maximum = Number(proposal.maximum_quantity);
    if (quantity < minimum || quantity > maximum)
      throw new Error(
        `Ideal request must stay between ${minimum} and ${maximum}`,
      );
    const calculation = proposal.calculation as any;
    const allocation = allocateDemoRequest({
      ideal: quantity,
      minimum,
      maximum,
      donorOffer: Number(calculation.donorOffer),
      vendorOffer: Number(calculation.vendorOffer),
      logisticsCap: Number(calculation.logisticsCap),
    });
    if (!allocation.feasible)
      throw new Error("The revised request is infeasible");
    const oldPlan = proposal.plan as any;
    const donor =
      allocation.allocations.find((entry) => entry.source === "donor")
        ?.allocated || 0;
    const vendor =
      allocation.allocations.find((entry) => entry.source === "vendor")
        ?.allocated || 0;
    const newPlan = {
      ...oldPlan,
      allocations: oldPlan.allocations
        .map((source: any) => ({
          ...source,
          quantity: source.sourceType === "site" ? donor : vendor,
        }))
        .filter((source: any) => source.quantity > 0),
      explanation: `ATLAS recomputed proposal version ${Number(proposal.version) + 1}: donor ${donor}, vendor ${vendor}, logistics cap ${calculation.logisticsCap}.`,
    };
    await client.query(
      "DELETE FROM shipment_events WHERE shipment_id IN(SELECT id FROM shipments WHERE transfer_proposal_id=$1)",
      [proposal.id],
    );
    await client.query("DELETE FROM shipments WHERE transfer_proposal_id=$1", [
      proposal.id,
    ]);
    await client.query(
      "DELETE FROM inventory_reservations WHERE transfer_proposal_id=$1",
      [proposal.id],
    );
    await client.query(
      "DELETE FROM inventory_transactions WHERE transfer_proposal_id=$1",
      [proposal.id],
    );
    await client.query(
      "UPDATE required_approvals SET status='pending',decision_by=NULL,decision_note=NULL,decided_at=NULL WHERE transfer_proposal_id=$1",
      [proposal.id],
    );
    await client.query(
      "UPDATE transfer_proposals SET requested_quantity=$2,optimizer_recommended_quantity=$3,human_approved_quantity=NULL,calculation=calculation||$4::jsonb,plan=$5,status='awaiting_approvals',version=version+1,updated_at=now() WHERE id=$1",
      [
        proposal.id,
        quantity,
        allocation.total,
        JSON.stringify({ ideal: quantity }),
        newPlan,
      ],
    );
    return {
      version: Number(proposal.version) + 1,
      recommended: allocation.total,
    };
  });
}

export async function dispatchJudgeDemo(session: Session) {
  return withTransaction(async (client) => {
    const found = await client.query(
      "SELECT s.*,p.id proposal_id,p.status proposal_status,p.plan,p.negotiation_id FROM shipments s JOIN transfer_proposals p ON p.id=s.transfer_proposal_id JOIN negotiations n ON n.id=p.negotiation_id WHERE n.region=$1 FOR UPDATE OF s,p",
      [KEY],
    );
    const shipment = found.rows[0];
    if (!shipment)
      throw new Error("Approve all four commitments before dispatch");
    const status = nextShipmentStatus(shipment.status, "dispatch");
    if (shipment.status === status) return { status };
    const plan = shipment.plan as any;
    for (const allocation of plan.allocations) {
      if (allocation.sourceType === "site") {
        const itemRow = await client.query(
          "SELECT * FROM inventory_items WHERE site_id=$1 AND category=$2 AND source_name=$3 FOR UPDATE",
          [allocation.sourceId, CATEGORY, KEY],
        );
        if (
          !itemRow.rows[0] ||
          Number(itemRow.rows[0].quantity) < allocation.quantity
        )
          throw new Error("Donor inventory changed before dispatch");
        await client.query(
          "UPDATE inventory_items SET quantity=quantity-$2,row_version=row_version+1,updated_by=$3,updated_at=now() WHERE id=$1",
          [itemRow.rows[0].id, allocation.quantity, session.userId],
        );
        await transaction(client, {
          organizationId: allocation.organizationId,
          siteId: allocation.sourceId,
          itemId: itemRow.rows[0].id,
          quantity: allocation.quantity,
          direction: "out",
          type: "transfer_out",
          key: `${KEY}:dispatch:${shipment.id}:${allocation.sourceId}`,
          userId: session.userId,
          proposalId: shipment.proposal_id,
        });
        await transaction(client, {
          organizationId: allocation.organizationId,
          siteId: allocation.sourceId,
          itemId: itemRow.rows[0].id,
          quantity: allocation.quantity,
          direction: "release",
          type: "reservation_release",
          key: `${KEY}:release:${shipment.id}:${allocation.sourceId}`,
          userId: session.userId,
          proposalId: shipment.proposal_id,
        });
      } else {
        await client.query(
          "UPDATE vendor_supply SET available_quantity=available_quantity-$2,status=CASE WHEN available_quantity-$2=0 THEN 'reserved' ELSE 'partially_reserved' END,version=version+1,updated_at=now() WHERE id=$1",
          [allocation.sourceId, allocation.quantity],
        );
      }
    }
    await client.query(
      "UPDATE inventory_reservations SET status='consumed' WHERE transfer_proposal_id=$1",
      [shipment.proposal_id],
    );
    await client.query(
      "UPDATE shipments SET status='dispatched',updated_at=now() WHERE id=$1",
      [shipment.id],
    );
    await client.query(
      "UPDATE transfer_proposals SET status='dispatched',updated_at=now() WHERE id=$1",
      [shipment.proposal_id],
    );
    await client.query(
      "UPDATE negotiations SET status='dispatched',updated_at=now() WHERE id=$1",
      [shipment.negotiation_id],
    );
    await client.query(
      "INSERT INTO shipment_events(shipment_id,event_type,actor_user_id,payload,idempotency_key) VALUES($1,'dispatched',$2,$3,$4) ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",
      [
        shipment.id,
        session.userId,
        { quantity: 150 },
        `${KEY}:shipment:${shipment.id}:dispatch`,
      ],
    );
    return { status: "dispatched" };
  });
}

export async function receiveJudgeDemo(session: Session) {
  return withTransaction(async (client) => {
    const found = await client.query(
      "SELECT s.*,p.id proposal_id,p.status proposal_status,p.plan,p.negotiation_id FROM shipments s JOIN transfer_proposals p ON p.id=s.transfer_proposal_id JOIN negotiations n ON n.id=p.negotiation_id WHERE n.region=$1 FOR UPDATE OF s,p",
      [KEY],
    );
    const shipment = found.rows[0];
    if (!shipment) throw new Error("No demo shipment exists");
    const status = nextShipmentStatus(shipment.status, "receive");
    if (shipment.status === status) return { status };
    const destination = await client.query(
        "SELECT s.*,o.id organization_id FROM sites s JOIN organizations o ON o.id=s.organization_id WHERE s.name=$1 AND o.demo_key=$2 FOR UPDATE",
        [
          names.fremont,
          `${KEY}:${names.fremont.toLowerCase().replaceAll(" ", "-")}`,
        ],
      ),
      siteRow = destination.rows[0],
      itemRow = await client.query(
        "SELECT * FROM inventory_items WHERE site_id=$1 AND category=$2 AND source_name=$3 FOR UPDATE",
        [siteRow.id, CATEGORY, KEY],
      );
    await client.query(
      "UPDATE inventory_items SET quantity=quantity+150,row_version=row_version+1,updated_by=$2,updated_at=now() WHERE id=$1",
      [itemRow.rows[0].id, session.userId],
    );
    await transaction(client, {
      organizationId: siteRow.organization_id,
      siteId: siteRow.id,
      itemId: itemRow.rows[0].id,
      quantity: 150,
      direction: "in",
      type: "transfer_in",
      key: `${KEY}:receipt:${shipment.id}`,
      userId: session.userId,
      proposalId: shipment.proposal_id,
    });
    await client.query(
      "UPDATE shipments SET status='received',updated_at=now() WHERE id=$1",
      [shipment.id],
    );
    await client.query(
      "UPDATE transfer_proposals SET status='received',updated_at=now() WHERE id=$1",
      [shipment.proposal_id],
    );
    await client.query(
      "UPDATE negotiations SET status='received',updated_at=now() WHERE id=$1",
      [shipment.negotiation_id],
    );
    await client.query(
      "INSERT INTO shipment_events(shipment_id,event_type,actor_user_id,payload,idempotency_key) VALUES($1,'received',$2,$3,$4) ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",
      [
        shipment.id,
        session.userId,
        { quantity: 150 },
        `${KEY}:shipment:${shipment.id}:receive`,
      ],
    );
    return { status: "received" };
  });
}
