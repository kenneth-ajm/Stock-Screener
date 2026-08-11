import { NextResponse } from "next/server";
import { OBS_KEYS, writeObservabilityStatus } from "@/lib/observability";
import { runPopulate } from "@/lib/populate_sector_momentum";

async function failureResponse(errorValue: unknown) {
  const error = errorValue instanceof Error
    ? errorValue.message
    : typeof errorValue === "string"
      ? errorValue
      : JSON.stringify(errorValue);
  const detail = errorValue instanceof Error ? errorValue.stack ?? null : null;
  await writeObservabilityStatus({
    key: OBS_KEYS.sector,
    value: { ok: false, error },
  }).catch(() => null);
  return NextResponse.json({ ok: false, error, detail }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { universe_slug?: string };
    return await runPopulate({ universe_slug: body?.universe_slug });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function GET() {
  try {
    return await runPopulate();
  } catch (error) {
    return failureResponse(error);
  }
}
