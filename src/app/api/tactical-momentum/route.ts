import { GET as handleGet } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGet(req);
}
