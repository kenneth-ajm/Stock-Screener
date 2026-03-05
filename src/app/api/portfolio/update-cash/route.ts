import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { cash_balance?: unknown };
    const raw = body?.cash_balance;
    const defaultRow = await supabase
      .from("portfolios")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    if (defaultRow.error) {
      return NextResponse.json({ ok: false, error: defaultRow.error.message }, { status: 500 });
    }
    const portfolioId = defaultRow.data?.id ?? null;
    if (!portfolioId) {
      return NextResponse.json({ ok: false, error: "No active portfolio" }, { status: 404 });
    }

    if (raw == null || String(raw).trim() === "") {
      const clearResult = await supabase
        .from("portfolios")
        .update({ cash_balance: null, cash_updated_at: null })
        .eq("id", portfolioId);
      if (clearResult.error) {
        return NextResponse.json({ ok: false, error: clearResult.error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, cash_balance: null, cash_updated_at: null });
    }

    const cashBalance = Number(raw);
    if (!Number.isFinite(cashBalance) || cashBalance < 0) {
      return NextResponse.json(
        { ok: false, error: "cash_balance must be a non-negative number" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const updateResult = await supabase
      .from("portfolios")
      .update({ cash_balance: cashBalance, cash_updated_at: now })
      .eq("id", portfolioId)
      .select("id,cash_balance,cash_updated_at")
      .maybeSingle();
    const data = updateResult.data;
    if (updateResult.error) {
      return NextResponse.json({ ok: false, error: updateResult.error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ ok: false, error: "No active portfolio" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      cash_balance: data.cash_balance,
      cash_updated_at: data.cash_updated_at,
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
