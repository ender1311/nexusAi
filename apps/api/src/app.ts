import { Hono } from "hono";
import { logger } from "hono/logger";
import { serviceAuth } from "./middleware/auth";
import { agentsRoute } from "./routes/agents";

const app = new Hono();
app.use("*", logger());
app.get("/health", (c) => c.json({ ok: true })); // health check excluded from auth
app.use("*", serviceAuth);                         // all other routes require bearer token
app.route("/agents", agentsRoute);

export { app };
