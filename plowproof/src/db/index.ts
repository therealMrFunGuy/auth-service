import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Reuse one connection pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/plowproof";
// Poolers in transaction mode (Neon "-pooler" hosts, PgBouncer, Supabase :6543) don't support prepared statements.
const pooled = /-pooler\.|pgbouncer=true|:6543\//.test(url);
const client = globalForDb.pg ?? postgres(url, { max: process.env.VERCEL ? 3 : 10, prepare: !pooled });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export { schema };
