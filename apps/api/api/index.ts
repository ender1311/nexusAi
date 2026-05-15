import { app } from "../src/app";

// Node.js 22 runtime supports Web Standard Request/Response natively.
export const config = { runtime: "nodejs22.x" };

export default async (req: Request): Promise<Response> => app.fetch(req);
