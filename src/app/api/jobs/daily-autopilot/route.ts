import { GET as handleGet, POST as handlePost } from "./handler";

export const maxDuration = 300;

export async function GET() {
  return handleGet();
}

export async function POST() {
  return handlePost();
}
