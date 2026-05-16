import { getRequestListener } from "@hono/node-server";
import { app } from "../src/app";

if (!process.env.INTERNAL_API_SECRET) {
  throw new Error("INTERNAL_API_SECRET env var is required");
}

export default getRequestListener(app.fetch);
