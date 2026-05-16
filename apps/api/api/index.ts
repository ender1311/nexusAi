import { getRequestListener } from "@hono/node-server";
import { app } from "../src/app";

export default getRequestListener(app.fetch);
