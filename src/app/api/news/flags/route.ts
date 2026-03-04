import { NextResponse } from "next/server";
import { fetchNewsRiskFlags } from "@/lib/externalRisk";

function parseSymbols(input: string | null) {
  if (!input) return [];
  return input
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbols = parseSymbols(url.searchParams.get("symbols"));
    if (symbols.length === 0) {
      return NextResponse.json({ ok: false, error: "symbols query param required" }, { status: 400 });
    }
    const flags = await fetchNewsRiskFlags(symbols);
    return NextResponse.json({ ok: true, flags });
  } catch (e: unknown) {
    console.error("news flags error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

