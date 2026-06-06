import { PrismaClient } from "../generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { neonConfig } from "@neondatabase/serverless";
import { WebSocket } from "ws";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL env var is required");
}

// The Neon adapter sends plain queries over HTTP but opens a WebSocket for
// transactions (Prisma nested writes run as interactive transactions). Without
// an explicit constructor the driver falls back to the runtime's global
// WebSocket; on Vercel's Node runtime that global constructs but cannot carry
// Neon's wire protocol, so transactions hang until the function times out
// (manifested as a 504 on every agent create). Pin the battle-tested `ws`
// implementation so write transactions connect reliably on the server.
neonConfig.webSocketConstructor = WebSocket;

const url = new URL(process.env.DATABASE_URL);
const connectionString = url.toString();

// The Neon serverless driver speaks Neon's WebSocket/HTTP protocol and cannot
// reach a plain Postgres on localhost — used by the local integration test DB.
// Pick the node-postgres adapter there; keep PrismaNeon for prod/preview.
const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
const adapter = isLocal
  ? new PrismaPg({ connectionString })
  : new PrismaNeon({ connectionString });

export const prisma = new PrismaClient(
  { adapter } as ConstructorParameters<typeof PrismaClient>[0]
);
