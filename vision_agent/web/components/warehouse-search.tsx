"use client";

import { FormEvent, useState } from "react";
import { apiJson } from "./client-api";

type Item = { id:string; product_name:string; brand:string|null; category:string; quantity:string; unit:string; expiration_date:string|null; warehouse_zone:string|null; bin_location:string|null; condition:string };
type SearchResult = { count:number; interpreter:string; parsed:Record<string,unknown>; items:Item[] };

export function WarehouseSearch() {
  const [query, setQuery] = useState("show everything expiring this week");
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = await apiJson<SearchResult>("/api/inventory/search", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({query}) });
      setItems(body.items); setMeta(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Search failed"); }
    finally { setBusy(false); }
  }

  return <div className="warehouse-search">
    <div><p className="eyebrow">Natural-language warehouse search</p><h3>Ask the ledger</h3></div>
    <form onSubmit={submit}><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Where are all canned vegetables?"/><button className="button primary" disabled={busy}>{busy?"Searching…":"Search"}</button></form>
    {error&&<p className="error">{error}</p>}
    {meta&&<div className="search-results"><div className="search-meta"><strong>{meta.count} results</strong><span>{meta.interpreter==="openai"?"OpenAI structured query":"Safe rules interpreter"} · site-scoped SQL</span></div>{items.length?<div className="result-list">{items.map(item=><div key={item.id}><div><strong>{item.product_name}</strong><small>{item.brand||"No brand"} · {item.category}</small></div><span>{item.warehouse_zone||"No zone"} / {item.bin_location||"No bin"}</span><b>{Number(item.quantity).toLocaleString()} {item.unit}</b><time>{item.expiration_date?new Date(item.expiration_date).toLocaleDateString():"No expiry"}</time></div>)}</div>:<p className="muted">No matching inventory at this food bank.</p>}</div>}
  </div>;
}
