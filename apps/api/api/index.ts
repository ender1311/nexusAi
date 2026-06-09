import { handle } from "hono/vercel";
import { app } from "../src/app";

if (!process.env.INTERNAL_API_SECRET) {
  throw new Error("INTERNAL_API_SECRET env var is required");
}

// Vercel's Node runtime invokes a default export Node-style (IncomingMessage,
// ServerResponse) with the body pre-consumed by its helpers, which hangs every
// POST until the function times out (504). Web-standard handling — an intact
// Request with a readable body — is only triggered by named HTTP-method
// exports, so export the Hono app under each method instead of `default`.
const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
