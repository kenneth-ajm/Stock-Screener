import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  getPaperTradingCapacity,
  makePaperAccountClient,
  resetPaperPortfolio,
  setPaperCashTotal,
} from "@/lib/paper_account";

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function defaultCash() {
  const env = Number(process.env.PAPER_DEFAULT_CASH ?? "");
  if (Number.isFinite(env) && env > 0) return env;
  return 25_000;
}

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

  const body = await req.json().catch(() => ({} as any));
  const requested = toNum(body?.cash_balance);
  const cash = requested != null && requested >= 0 ? requested : defaultCash();
  const clearPositions = Boolean(body?.reset_positions);

  const admin = makePaperAccountClient();
  if (clearPositions) {
    await resetPaperPortfolio({ supabase: admin, user_id: user.id });
  }
  const setOut = await setPaperCashTotal({
    supabase: admin,
    user_id: user.id,
    cash_total: cash,
    note: clearPositions ? "reset_cash_and_positions" : "reset_cash",
  });
  const capacity = await getPaperTradingCapacity({ supabase: admin, user_id: user.id });

  return NextResponse.json({
    ok: true,
    cash_total: capacity.cash_total,
    cash_available: capacity.cash_available,
    capital_deployed: capacity.capital_deployed,
    source: capacity.source,
    updated_at: setOut.updated_at,
    reset_positions: clearPositions,
  });
}

