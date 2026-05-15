import { app } from "./app";

if (!process.env.INTERNAL_API_SECRET) {
  throw new Error("INTERNAL_API_SECRET env var is required");
}

const port = parseInt(process.env.PORT ?? "3001", 10);
if (process.env.NODE_ENV !== "test") console.log(`API service on port ${port}`);

export default { port, fetch: app.fetch };
export { app };
