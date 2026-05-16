import { app } from "../src/app";

export default async (req: Request): Promise<Response> => app.fetch(req);
