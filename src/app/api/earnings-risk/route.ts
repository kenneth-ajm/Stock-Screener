import { NextResponse } from "next/server";
import { lookupEarningsRiskForSymbols } from "@/lib/earnings_risk";

export const dynamic = "force-dynamic";

type Body = {
  symbols?: string[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const symbols = Array.isArray(body?.symbols) ? body.symbols : [];
    const map = await lookupEarningsRiskForSymbols(symbols);
    return NextResponse.json({ ok: true, earnings: map });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

