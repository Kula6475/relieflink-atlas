import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Pool } from "@neondatabase/serverless";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString });
  try {
    const directory=join(process.cwd(),"migrations");
    const files=(await readdir(directory)).filter(file=>file.endsWith(".sql")).sort();
    for(const file of files){await pool.query(await readFile(join(directory,file),"utf8"));console.log(`Applied ${file}`);}
  } finally {
    await pool.end();
  }
}

void main();
