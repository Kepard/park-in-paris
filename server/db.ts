import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
let sql: NeonQueryFunction<false, false> | undefined;
export function database() {
  if (!process.env.DATABASE_URL) throw new Error("Trip storage is not configured");
  return sql ??= neon(process.env.DATABASE_URL);
}
