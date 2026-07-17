import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { foodBankContext, canEditInventory } from "../../../../lib/food-bank";
import { withTransaction } from "../../../../lib/db";

function parseLine(line: string) {
  const out: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; } else quoted = !quoted;
    } else if (character === "," && !quoted) { out.push(value.trim()); value = ""; } else value += character;
  }
  out.push(value.trim());
  return out;
}

const key = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_");
type Row = Record<string, string | number> & { product_name: string; category: string; quantity: number; unit: string };

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const context = await foodBankContext(session);
    if (!canEditInventory(context.role)) throw new Error("Inventory import permission required");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) throw new Error("Choose a CSV file");
    if (file.size > 3_000_000) throw new Error("CSV must be smaller than 3 MB");
    const lines = (await file.text()).split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error("CSV needs a header and at least one item");
    const headers = parseLine(lines[0]).map(key);
    const legacy = headers.includes("count") && headers.includes("site");
    if (!legacy) for (const required of ["product_name", "category", "quantity", "unit"]) if (!headers.includes(required)) throw new Error(`Missing required column: ${required}`);
    const records: Row[] = lines.slice(1).map((line, index) => {
      const values = parseLine(line);
      const row = Object.fromEntries(headers.map((header, position) => [header, values[position] ?? ""])) as Record<string, string>;
      const quantity = Number(legacy ? row.count : row.quantity);
      const productName = legacy ? (row.product_name || row.category.replaceAll("_", " ")) : row.product_name;
      const unit = legacy ? (row.unit || "items") : row.unit;
      if (!productName || !row.category || !unit || !Number.isFinite(quantity) || quantity < 0) throw new Error(`Row ${index + 2} has invalid required values`);
      return { ...row, product_name: productName, category: row.category, quantity, unit, source_name: legacy ? (row.source_name || row.site) : row.source_name } as Row;
    });
    const items = await withTransaction(async (client) => {
      const added = [];
      for (const row of records) added.push((await client.query(`INSERT INTO inventory_items(organization_id,site_id,product_name,brand,category,subcategory,quantity,unit,lot_number,expiration_date,warehouse_zone,bin_location,condition,source_name,barcode,notes,intake_method,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'csv',$17,$17) RETURNING *`, [context.organizationId, context.siteId, row.product_name, row.brand || null, row.category, row.subcategory || null, row.quantity, row.unit, row.lot_number || null, row.expiration_date || null, row.warehouse_zone || null, row.bin_location || null, row.condition || "good", row.source_name || null, row.barcode || null, row.notes || null, session.userId])).rows[0]);
      return added;
    });
    return NextResponse.json({ imported: items.length, items, format: legacy ? "legacy_site_category_count" : "inventory_template" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CSV import failed" }, { status: 400 });
  }
}
