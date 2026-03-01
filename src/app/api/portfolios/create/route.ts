import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "Main").trim() || "Main";
  const accountCurrency = String(body?.account_currency ?? "USD").trim() || "USD";

  const accountSize = Number(body?.account_size);
  if (!Number.isFinite(accountSize) || accountSize <= 0) {
    return NextResponse.json({ ok: false, error: "account_size must be a positive number" }, { status: 400 });
  }

  // Store as decimal (0.02 = 2%)
  const riskPerTrade = body?.risk_per_trade == null ? 0.02 : Number(body?.risk_per_trade);
  if (!Number.isFinite(riskPerTrade) || riskPerTrade <= 0 || riskPerTrade > 0.2) {
    return NextResponse.json({ ok: false, error: "risk_per_trade must be a decimal like 0.02 (2%), max 0.2" }, { status: 400 });
  }

  const maxPositions = body?.max_positions == null ? 5 : Number(body?.max_positions);
  if (!Number.isFinite(maxPositions) || maxPositions <= 0 || maxPositions > 100) {
    return NextResponse.json({ ok: false, error: "max_positions must be between 1 and 100" }, { status: 400 });
  }

  // If this is the first portfolio, make it default
  const { data: existing } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);

  const isFirst = !existing || existing.length === 0;

  const { data: inserted, error } = await supabase
    .from("portfolios")
    .insert({
      user_id: user.id,
      name,
      account_currency: accountCurrency,
      account_size: accountSize,
      risk_per_trade: riskPerTrade,
      max_positions: maxPositions,
      is_default: isFirst ? true : false,
    })
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, portfolio: inserted });
}