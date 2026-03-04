import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { POST as quotesPost } from "@/app/api/quotes/route";

type OpenPosition = {
  symbol: string | null;
  entry_price: number | null;
  shares: number | null;
  quantity: number | null;
  position_size: number | null;
};

type QuoteValue = {
  price: number;
  asOf: string;
  source: "snapshot" | "eod_close";
} | null;

function resolveShares(p: OpenPosition) {
  const raw = p.shares ?? p.quantity ?? p.position_size ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

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
    .select("id, account_currency, account_size, risk_per_trade, max_positions, default_fee_per_order")
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

  const { data: openPositions, error: openErr } = await supabase
    .from("portfolio_positions")
    .select("symbol, entry_price, shares, quantity, position_size")
    .eq("user_id", user.id)
    .eq("portfolio_id", portfolio.id)
    .eq("status", "OPEN")
    .returns<OpenPosition[]>();

  if (openErr) {
    return NextResponse.json(
      { ok: false, error: openErr.message },
      { status: 500 }
    );
  }

  const symbols = Array.from(
    new Set(
      (openPositions ?? [])
        .map((p) => String(p.symbol ?? "").toUpperCase().trim())
        .filter(Boolean)
    )
  );

  let quotes: Record<string, QuoteValue> = {};
  if (symbols.length > 0) {
    try {
      const qReq = new Request("http://localhost/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      const qRes = await quotesPost(qReq);
      const qJson = await qRes.json().catch(() => null);
      if (qRes.ok && qJson?.ok && qJson?.quotes && typeof qJson.quotes === "object") {
        quotes = qJson.quotes as Record<string, QuoteValue>;
      }
    } catch {
      // fallback below uses entry prices when live quotes are unavailable
    }
  }

  let investedValue = 0;
  let investedCost = 0;
  const openPositionRows = (openPositions ?? []).map((p) => {
    const symbol = String(p.symbol ?? "").toUpperCase().trim();
    const sharesHeld = resolveShares(p);
    const entryPrice = Number(p.entry_price);
    const entryPriceSafe = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 0;
    const liveRaw = quotes[symbol];
    const liveFromQuote = typeof liveRaw?.price === "number" ? liveRaw.price : null;
    const livePrice =
      typeof liveFromQuote === "number" && Number.isFinite(liveFromQuote) && liveFromQuote > 0
        ? liveFromQuote
        : entryPriceSafe > 0
          ? entryPriceSafe
          : null;

    investedCost += sharesHeld * entryPriceSafe;
    if (typeof livePrice === "number" && Number.isFinite(livePrice) && livePrice > 0) {
      investedValue += sharesHeld * livePrice;
    }

    return {
      symbol,
      shares: sharesHeld,
      entry_price: entryPriceSafe > 0 ? entryPriceSafe : null,
      live_price: livePrice,
    };
  });

  const cashAvailable = accountSize - investedCost;
  const equity = cashAvailable + investedValue;
  const riskAmount = equity * riskPerTrade;
  const riskPerShare = entry - stop;

  const sharesByRiskRaw = riskAmount / riskPerShare;
  const sharesByRisk = Math.max(0, Math.floor(sharesByRiskRaw));
  const sharesByCash = entry > 0 ? Math.max(0, Math.floor(cashAvailable / entry)) : 0;
  const shares = Math.max(0, Math.min(sharesByRisk, sharesByCash));
  const positionValue = shares * entry;

  return NextResponse.json({
    ok: true,
    portfolio_id: portfolio.id,
    account_currency: portfolio.account_currency,
    account_size: accountSize,
    cash_available: cashAvailable,
    invested_value: investedValue,
    equity,
    open_positions: openPositionRows,
    risk_per_trade: riskPerTrade,
    risk_per_trade_pct: riskPerTrade * 100,
    default_fee_per_order:
      typeof portfolio.default_fee_per_order === "number" &&
      Number.isFinite(Number(portfolio.default_fee_per_order))
        ? Number(portfolio.default_fee_per_order)
        : null,
    risk_amount: riskAmount,
    entry,
    stop,
    risk_per_share: riskPerShare,
    shares_by_risk: sharesByRisk,
    shares_by_cash: sharesByCash,
    shares,
    position_value: positionValue,
  });
}
