import { NextResponse } from "next/server";
import { runDiagnostics } from "@/lib/diagnostics";

export async function GET() {
  try {
    const result = await runDiagnostics();
    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error("diagnostics error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
