import { app } from "../src/app";

export const config = { runtime: "edge" };

export default async (req: Request): Promise<Response> => app.fetch(req);
