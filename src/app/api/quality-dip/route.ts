import { GET as handleGet } from "./handler";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleGet();
}
