import { neon } from "@neondatabase/serverless";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = neon(process.env.DATABASE_URL);
await sql`CREATE TABLE IF NOT EXISTS parking_trips (owner_hash char(64) NOT NULL, id uuid NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL, PRIMARY KEY (owner_hash, id))`;
await sql`CREATE INDEX IF NOT EXISTS parking_trips_owner_created ON parking_trips (owner_hash, created_at DESC)`;
await sql`ALTER TABLE parking_trips ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false`;
console.log("Private trip storage is ready.");
