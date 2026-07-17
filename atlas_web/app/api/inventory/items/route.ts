import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "../../../../lib/auth";
import { foodBankContext } from "../../../../lib/food-bank";
import { sql } from "../../../../lib/db";

const Item=z.object({productName:z.string().min(1).max(200),brand:z.string().max(120).nullable().optional(),category:z.string().min(1).max(80),subcategory:z.string().max(100).nullable().optional(),quantity:z.number().nonnegative(),unit:z.string().min(1).max(40),lotNumber:z.string().max(100).nullable().optional(),expirationDate:z.string().nullable().optional(),warehouseZone:z.string().max(100).nullable().optional(),binLocation:z.string().max(100).nullable().optional(),condition:z.enum(["good","damaged","quarantined","expired"]).default("good"),sourceName:z.string().max(160).nullable().optional(),barcode:z.string().max(100).nullable().optional(),notes:z.string().max(1000).nullable().optional()});

export async function GET(){
 const session=await getSession(); if(!session)return NextResponse.json({error:"Authentication required"},{status:401});
 const context=await foodBankContext(session); const rows=await sql()`SELECT * FROM inventory_items WHERE site_id=${context.siteId} ORDER BY expiration_date NULLS LAST,product_name`;
 return NextResponse.json({context,items:rows});
}

export async function POST(request:Request){
 const session=await getSession(); if(!session)return NextResponse.json({error:"Authentication required"},{status:401});
 try{const context=await foodBankContext(session); const x=Item.parse(await request.json());
 const rows=await sql()`INSERT INTO inventory_items(organization_id,site_id,product_name,brand,category,subcategory,quantity,unit,lot_number,expiration_date,warehouse_zone,bin_location,condition,source_name,barcode,notes,created_by,updated_by)
 VALUES(${context.organizationId},${context.siteId},${x.productName},${x.brand??null},${x.category},${x.subcategory??null},${x.quantity},${x.unit},${x.lotNumber??null},${x.expirationDate||null},${x.warehouseZone??null},${x.binLocation??null},${x.condition},${x.sourceName??null},${x.barcode??null},${x.notes??null},${session.userId},${session.userId}) RETURNING *`;
 return NextResponse.json({item:rows[0]},{status:201});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid item"},{status:400});}
}
