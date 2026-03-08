import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getActivePortfolioCapacity } from "@/lib/portfolio_capacity";
import { getOrRepairDefaultPortfolio } from "@/lib/get_or_repair_default_portfolio";

const ALLOWED_OPEN_STATUSES = new Set(["PENDING", "OPEN"]);

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const symbol = String(body?.symbol ?? "").trim().toUpperCase();
  const strategyVersion = String(body?.strategy_version ?? "v1").trim() || "v1";
  const entryPrice = Number(body?.entry_price);
  const stopPrice = Number(body?.stop_price ?? body?.stop);
  const tp1 = body?.tp1 == null || body?.tp1 === "" ? null : Number(body.tp1);
  const tp2 = body?.tp2 == null || body?.tp2 === "" ? null : Number(body.tp2);
  const shares = Math.floor(Number(body?.shares));
  const reasonSummary = body?.reason_summary == null ? null : String(body.reason_summary);
  const notes = body?.notes == null ? null : String(body.notes);
  const statusRaw = String(body?.status ?? "OPEN").trim().toUpperCase();
  const status = ALLOWED_OPEN_STATUSES.has(statusRaw) ? statusRaw : "OPEN";

  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return NextResponse.json({ ok: false, error: "entry_price invalid" }, { status: 400 });
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) return NextResponse.json({ ok: false, error: "stop_price invalid" }, { status: 400 });
  if (!(entryPrice > stopPrice)) return NextResponse.json({ ok: false, error: "entry_price must be greater than stop_price" }, { status: 400 });
  if (!Number.isFinite(shares) || shares <= 0) return NextResponse.json({ ok: false, error: "shares must be > 0" }, { status: 400 });
  if (tp1 !== null && (!Number.isFinite(tp1) || tp1 <= 0)) return NextResponse.json({ ok: false, error: "tp1 invalid" }, { status: 400 });
  if (tp2 !== null && (!Number.isFinite(tp2) || tp2 <= 0)) return NextResponse.json({ ok: false, error: "tp2 invalid" }, { status: 400 });

  const defaultPortfolio = await getOrRepairDefaultPortfolio({
    supabase: supabase as any,
    user_id: user.id,
  });

  const capacity = await getActivePortfolioCapacity({
    supabase: supabase as any,
    userId: user.id,
  });
  if (!capacity) {
    return NextResponse.json({ ok: false, error: "Portfolio capacity unavailable" }, { status: 400 });
  }

  const estimatedCost = shares * entryPrice;
  if (estimatedCost > Number(capacity.cash_available ?? 0)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Insufficient cash for paper position (cash-only rule)",
        detail: {
          cash_available: Number(capacity.cash_available ?? 0),
          estimated_cost: estimatedCost,
          shares,
          entry_price: entryPrice,
        },
      },
      { status: 400 }
    );
  }

  const insertPayload = {
    user_id: user.id,
    portfolio_id: defaultPortfolio?.id ?? null,
    symbol,
    strategy_version: strategyVersion,
    entry_price: entryPrice,
    stop_price: stopPrice,
    tp1,
    tp2,
    shares,
    status,
    reason_summary: reasonSummary,
    notes,
    opened_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("paper_positions")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    const missingTable =
      error.code === "PGRST205" || /paper_positions/i.test(error.message ?? "");
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        code: error.code ?? null,
        write_step: "insert_paper_position",
        hint: missingTable
          ? "Missing table: public.paper_positions. Apply docs/SQL/2026-03-08_paper_execution.sql (or supabase/migrations/20260308100000_paper_positions.sql)."
          : null,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, position: data });
}
