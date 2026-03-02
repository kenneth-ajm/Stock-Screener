import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import PositionsClient from "./PositionsClient";
import { computeClosedTradeSummary } from "@/lib/analytics/closedTradeSummary";

export const dynamic = "force-dynamic";

type Portfolio = {
  id: string;
  user_id: string;
  name?: string | null;
  account_currency?: string | null;
  account_size?: number | null;
  risk_per_trade?: number | null;
  max_positions?: number | null;
  is_default?: boolean | null;
};

type PositionRow = {
  id: string;
  portfolio_id: string;
  symbol: string;
  status: string;

  entry_price: number | null;
  stop_price: number | null;

  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;

  created_at: string | null;

  closed_at: string | null;
  exit_price: number | null;
};

function formatMoney(x: number | null | undefined) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `$${x.toFixed(2)}`;
}

function resolveQty(p: {
  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;
}) {
  const v =
    (typeof p.shares === "number" ? p.shares : null) ??
    (typeof p.quantity === "number" ? p.quantity : null) ??
    (typeof p.position_size === "number" ? p.position_size : null) ??
    0;
  return Number.isFinite(v) ? v : 0;
}

async function makeSupabaseServerClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // ok
        }
      },
    },
  });
}

async function fetchAndUpsertDailyBars(symbolRaw: string) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return;

  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return;

  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = fromDate.toISOString().slice(0, 10);

  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
    symbol
  )}/range/1/day/${from}/${to}?adjusted=false&sort=asc&limit=50000&apiKey=${apiKey}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return;

  const json = await res.json().catch(() => null);
  const results = json?.results ?? [];
  if (!Array.isArray(results) || results.length === 0) return;

  const supabase = await makeSupabaseServerClient();

  const rows = results.map((r: any) => ({
    symbol,
    date: new Date(r.t).toISOString().slice(0, 10),
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: Math.round(r.v),
    source: "polygon",
  }));

  await supabase.from("price_bars").upsert(rows, { onConflict: "symbol,date" });
}

export default async function PortfolioPage() {
  const supabase = await makeSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?next=/portfolio");
  }

  // Active/default portfolio
  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .maybeSingle<Portfolio>();

  if (!portfolio) {
    return (
      <div className="mx-auto max-w-6xl p-6 space-y-3 text-slate-900">
        <div className="text-2xl font-semibold tracking-tight">Portfolio</div>
        <div className="text-sm text-slate-600">
          No active portfolio found. Create one in Portfolios.
        </div>
        <div className="flex gap-2">
          <Link
            href="/portfolios"
            className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Go to Portfolios
          </Link>
          <Link
            href="/screener"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50"
          >
            <span aria-hidden="true">←</span>
            Back to Screener
          </Link>
        </div>
      </div>
    );
  }

  // Positions
  const { data: openPositions } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("portfolio_id", portfolio.id)
    .eq("status", "OPEN")
    .order("created_at", { ascending: false })
    .returns<PositionRow[]>();

  const { data: closedPositions } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("portfolio_id", portfolio.id)
    .eq("status", "CLOSED")
    .order("closed_at", { ascending: false })
    .returns<PositionRow[]>();

  const open = openPositions ?? [];
  const closed = closedPositions ?? [];

  // ✅ Auto-fetch latest prices for ALL open symbols
  const uniqueSymbols = [...new Set(open.map((p) => (p.symbol ?? "").toUpperCase()).filter(Boolean))];
  const latestPriceBySymbol: Record<string, number | null> = {};

  for (const symbol of uniqueSymbols) {
    const { data: latestRow } = await supabase
      .from("price_bars")
      .select("close")
      .eq("symbol", symbol)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRow) {
      await fetchAndUpsertDailyBars(symbol);

      const { data: retryRow } = await supabase
        .from("price_bars")
        .select("close")
        .eq("symbol", symbol)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      latestPriceBySymbol[symbol] = retryRow?.close ?? null;
    } else {
      latestPriceBySymbol[symbol] = latestRow.close ?? null;
    }
  }

  // Closed trade summary cards (existing)
  const closedSummary = computeClosedTradeSummary(
    closed.map((p) => ({
      symbol: p.symbol,
      entry_price: p.entry_price,
      exit_price: p.exit_price,
      shares: (p as any).shares ?? null,
      quantity: (p as any).quantity ?? null,
      position_size: (p as any).position_size ?? null,
      closed_at: p.closed_at,
    }))
  );

  // Realized stats (keep your proven working logic)
  let realizedPnL = 0;
  let realizedWins = 0;
  let realizedLosses = 0;

  for (const p of closed) {
    if (typeof p.entry_price !== "number" || typeof p.exit_price !== "number") continue;
    const qty = resolveQty(p);
    const pnl = (p.exit_price - p.entry_price) * qty;
    realizedPnL += pnl;
    if (pnl > 0) realizedWins += 1;
    if (pnl < 0) realizedLosses += 1;
  }

  const realizedTrades = realizedWins + realizedLosses;
  const winRate = realizedTrades ? realizedWins / realizedTrades : 0;

  // Exposure (capital + risk)
  let capitalDeployed = 0;
  let riskDeployed = 0;

  for (const p of open) {
    const entry = p.entry_price;
    const stop = p.stop_price;
    const qty = resolveQty(p);

    if (typeof entry === "number" && entry > 0 && qty > 0) {
      capitalDeployed += entry * qty;
    }

    // Only compute risk when stop exists
    if (typeof entry === "number" && entry > 0 && typeof stop === "number" && stop > 0 && qty > 0) {
      riskDeployed += Math.max(0, (entry - stop) * qty);
    }
  }

  const acctSize = portfolio.account_size ?? null;
  const pctDeployed = typeof acctSize === "number" && acctSize > 0 ? capitalDeployed / acctSize : null;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6 text-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Portfolio</div>
          <div className="text-sm text-slate-600">
            Active journey{portfolio.name ? `: ${portfolio.name}` : ""}
          </div>
        </div>

        <div className="flex gap-2">
          <Link
            href="/portfolios"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50"
          >
            Manage Portfolios
          </Link>
          <Link
            href="/screener"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 whitespace-nowrap"
          >
            <span aria-hidden="true">←</span>
            Back to Screener
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Open exposure</div>
          <div className="mt-1 text-sm text-slate-800">
            Capital deployed: <span className="font-semibold">{formatMoney(capitalDeployed)}</span>
          </div>
          <div className="mt-1 text-sm text-slate-800">
            Risk deployed: <span className="font-semibold">{formatMoney(riskDeployed)}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {pctDeployed !== null ? `${(pctDeployed * 100).toFixed(1)}% of account size` : "—"}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Realized performance</div>
          <div className="mt-1 text-sm text-slate-800">
            Realized P/L: <span className="font-semibold">{formatMoney(realizedPnL)}</span>
          </div>
          <div className="mt-1 text-sm text-slate-800">
            Win rate: <span className="font-semibold">{(winRate * 100).toFixed(0)}%</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{realizedTrades} closed trades</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Account</div>
          <div className="mt-1 text-sm text-slate-800">
            Size: <span className="font-semibold">{formatMoney(acctSize)}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">Currency: {portfolio.account_currency ?? "—"}</div>
        </div>
      </div>

      <PositionsClient
        openPositions={open as any}
        closedPositions={closed as any}
        closedSummary={closedSummary}
        latestPriceBySymbol={latestPriceBySymbol}
      />
    </div>
  );
}