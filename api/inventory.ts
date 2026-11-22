import type { IncomingMessage, ServerResponse } from "node:http";
import { readParisInventory } from "../server/parkingInventory.js";
import { packInventory } from "../src/lib/inventoryFormat.js";

let loading: Promise<string> | undefined;
async function payload() {
  const inventory = await readParisInventory(AbortSignal.timeout(20000));
  const json = JSON.stringify(packInventory(inventory));
  if (Buffer.byteLength(json) > 4_400_000) throw new Error("Inventory exceeds the response size limit.");
  return json;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.writeHead(405).end();
    return;
  }
  try {
    loading ??= payload().finally(() => { loading = undefined; });
    const json = await loading;
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.writeHead(200).end(req.method === "HEAD" ? undefined : json);
  } catch (error) {
    console.error("Parking inventory refresh failed", error instanceof Error ? error.message : "Paris data unavailable");
    res.writeHead(503).end(JSON.stringify({ error: "Paris parking data is temporarily unavailable." }));
  }
}
