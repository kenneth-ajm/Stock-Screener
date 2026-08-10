import { NextResponse } from "next/server";
import { lookupEarningsRiskForSymbols } from "@/lib/earnings_risk";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Body = {
  symbols?: string[];
};

export async function POST(req: Request) {
  try {
    const authClient = await supabaseServer();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Body;
    const symbols = Array.isArray(body?.symbols) ? body.symbols : [];
    const map = await lookupEarningsRiskForSymbols(symbols);
    return NextResponse.json({
      ok: true,
      earnings: map,
      calendar_source_configured: process.env.ENABLE_POLYGON_EARNINGS_LOOKUP === "1",
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
