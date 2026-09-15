import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { database } from "../server/db.js";
import { tripSchema } from "../server/schema.js";

const COOKIE = "pip_private_history";
const allowedOrigins = new Set(["https://parkinparis.kepard.dev", "https://kepard.dev", "https://park-in-paris.vercel.app", ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []), ...(process.env.NODE_ENV !== "production" ? ["http://localhost:5173", "http://localhost:4173"] : [])]);

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie, Origin");
  const respond = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
  if (!["GET", "PUT", "DELETE"].includes(req.method || "")) { res.setHeader("Allow", "GET, PUT, DELETE"); return respond(405, { error: "Method not allowed" }); }
  if (req.headers["sec-fetch-site"] === "cross-site" || (req.headers.origin && !allowedOrigins.has(req.headers.origin))) return respond(403, { error: "Request origin not allowed" });
  if (req.method !== "GET" && req.headers["x-park-client"] !== "1") return respond(403, { error: "Missing request verification" });
  // Only the new app may read the old host’s private history during migration.
  if (req.method === "GET" && req.headers.origin === "https://parkinparis.kepard.dev") {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  let token = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const newHistory = !token || !/^[a-f0-9]{64}$/.test(token);
  if (newHistory) {
    if (req.method !== "GET") return respond(401, { error: "Open your trip history before saving" });
    token = randomBytes(32).toString("hex");
  }
  if (req.method === "GET") {
    const secure = process.env.NODE_ENV === "production" || !!process.env.VERCEL ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=31536000`);
  }
  const owner = createHash("sha256").update(token!).digest("hex");
  try {
    const sql = database();
    if (req.method === "GET") {
      const rows = await sql`SELECT payload FROM parking_trips WHERE owner_hash = ${owner} AND deleted = false ORDER BY created_at DESC LIMIT 100`;
      return respond(200, { trips: rows.map(r => r.payload), newHistory });
    }
    if (req.method === "DELETE") {
      const id = new URL(req.url || "/", "https://park.invalid").searchParams.get("id");
      if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return respond(400, { error: "Invalid trip ID" });
      // Keep only a deletion marker so a delayed upload from another tab cannot restore private trip data.
      await sql`INSERT INTO parking_trips (owner_hash, id, created_at, payload, deleted) VALUES (${owner}, ${id}::uuid, now(), '{}'::jsonb, true) ON CONFLICT (owner_hash, id) DO UPDATE SET payload = '{}'::jsonb, deleted = true, updated_at = now()`;
      return respond(200, { deleted: true });
    }
    if (Number(req.headers["content-length"] || 0) > 512000) return respond(413, { error: "Trip is too large" });
    let body = req.body;
    if (body === undefined) {
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 512000) return respond(413, { error: "Trip is too large" }); }
      try { body = JSON.parse(raw); } catch { return respond(400, { error: "Invalid JSON" }); }
    } else if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return respond(400, { error: "Invalid JSON" }); }
    }
    if (Buffer.byteLength(JSON.stringify(body) || "") > 512000) return respond(413, { error: "Trip is too large" });
    const parsed = tripSchema.safeParse(body);
    if (!parsed.success) return respond(400, { error: "The trip contains invalid or incomplete data" });
    const trip = parsed.data;
    await sql.transaction([
      sql`INSERT INTO parking_trips (owner_hash, id, created_at, payload) VALUES (${owner}, ${trip.id}::uuid, ${trip.createdAt}::timestamptz, ${JSON.stringify(trip)}::jsonb) ON CONFLICT (owner_hash, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now() WHERE parking_trips.deleted = false AND (parking_trips.payload->>'status' <> 'completed' OR EXCLUDED.payload->>'status' = 'completed')`,
      sql`UPDATE parking_trips SET payload = '{}'::jsonb, deleted = true, updated_at = now() WHERE owner_hash = ${owner} AND deleted = false AND id NOT IN (SELECT id FROM parking_trips WHERE owner_hash = ${owner} AND deleted = false ORDER BY created_at DESC LIMIT 100)`,
    ]);
    return respond(200, { saved: trip.id });
  } catch {
    return respond(503, { error: "Trip storage is temporarily unavailable. Your changes remain saved on this device." });
  }
}
