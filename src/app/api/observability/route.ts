import { NextResponse } from "next/server";
import { getObservabilitySnapshot } from "@/lib/observability";

export async function GET() {
  try {
    const snapshot = await getObservabilitySnapshot();
    return NextResponse.json(snapshot);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
