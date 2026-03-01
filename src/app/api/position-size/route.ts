import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET() {
  return NextResponse.json({
    ok: false,
    message: "Use POST with JSON: { entry, stop }",
  });
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
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const entry = Number(body?.entry);
  const stop = Number(body?.stop);

  if (!Number.isFinite(entry) || !Number.isFinite(stop)) {
    return NextResponse.json(
      { ok: false, error: "entry and stop must be numbers" },
      { status: 400 }
    );
  }

  if (entry <= stop) {
    return NextResponse.json(
      { ok: false, error: "Invalid trade: entry must be > stop" },
      { status: 400 }
    );
  }

  // Get the user's default portfolio (active journey)
  const { data: portfolio, error: pErr } = await supabase
    .from("portfolios")
    .select("id, account_currency, account_size, risk_per_trade, max_positions")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();

  if (pErr || !portfolio) {
    return NextResponse.json(
      { ok: false, error: pErr?.message || "No default portfolio found" },
      { status: 500 }
    );
  }

  const accountSize = Number(portfolio.account_size);
  const riskPerTrade = Number(portfolio.risk_per_trade);

  const riskAmount = accountSize * riskPerTrade;
  const riskPerShare = entry - stop;

  const sharesRaw = riskAmount / riskPerShare;
  const shares = Math.floor(sharesRaw); // conservative
  const positionValue = shares * entry;

  return NextResponse.json({
    ok: true,
    portfolio_id: portfolio.id,
    account_currency: portfolio.account_currency,
    account_size: accountSize,
    risk_per_trade: riskPerTrade,
    risk_amount: riskAmount,
    entry,
    stop,
    risk_per_share: riskPerShare,
    shares,
    position_value: positionValue,
  });
}