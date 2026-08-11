import { GET as handleGet, POST as handlePost } from "./handler";

export const maxDuration = 300;

export async function POST(req: Request) {
  return handlePost(req);
}

export async function GET(req: Request) {
  return handleGet(req);
}
