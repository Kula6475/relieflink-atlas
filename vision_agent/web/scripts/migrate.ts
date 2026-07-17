import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: join(process.cwd(), ".env.local"), quiet: true });
config({ path: join(process.cwd(), ".env"), quiet: true });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required. Add it to vision_agent/web/.env.local locally and to the Vercel project environment variables.");
  const pool = new Pool({ connectionString });
  try {
    const directory=join(process.cwd(),"migrations");
    for(const file of (await readdir(directory)).filter(x=>x.endsWith(".sql")).sort()){await pool.query(await readFile(join(directory,file),"utf8"));console.log(`Applied ${file}`);}
  } finally {
    await pool.end();
  }
}

void main();
