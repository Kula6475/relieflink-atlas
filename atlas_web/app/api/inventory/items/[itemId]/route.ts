import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "../../../../../lib/auth";
import { foodBankContext,canEditInventory } from "../../../../../lib/food-bank";
import { withTransaction } from "../../../../../lib/db";

const Update=z.object({field:z.enum(["product_name","brand","category","subcategory","quantity","unit","lot_number","expiration_date","warehouse_zone","bin_location","condition","source_name","barcode","notes"]),value:z.union([z.string(),z.number(),z.null()]),rowVersion:z.number().int().positive(),reason:z.string().min(3).max(300)});
const columns=new Set(Update.shape.field.options);
export async function PATCH(request:Request,ctx:{params:Promise<{itemId:string}>}){
 const session=await getSession();if(!session)return NextResponse.json({error:"Authentication required"},{status:401});
 try{const context=await foodBankContext(session);if(!canEditInventory(context.role))throw new Error("Inventory edit permission required");const input=Update.parse(await request.json());const {itemId}=await ctx.params;if(!columns.has(input.field))throw new Error("Field cannot be edited");
 const result=await withTransaction(async client=>{const found=await client.query("SELECT * FROM inventory_items WHERE id=$1 AND site_id=$2 FOR UPDATE",[itemId,context.siteId]);const before=found.rows[0];if(!before)throw new Error("Inventory item not found");if(before.row_version!==input.rowVersion)throw new Error("This row changed on another device. Refresh before editing.");
 const updated=(await client.query(`UPDATE inventory_items SET ${input.field}=$1,row_version=row_version+1,updated_by=$2,updated_at=now() WHERE id=$3 RETURNING *`,[input.value,session.userId,itemId])).rows[0];
 await client.query("INSERT INTO inventory_item_changes(inventory_item_id,organization_id,changed_by,before_value,after_value,change_reason) VALUES($1,$2,$3,$4,$5,$6)",[itemId,context.organizationId,session.userId,before,updated,input.reason]);return updated;});return NextResponse.json({item:result});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to update item"},{status:400});}
}
