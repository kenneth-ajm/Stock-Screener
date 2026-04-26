import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import PositionsClient from "./PositionsClient";
import { computeClosedTradeSummary } from "@/lib/analytics/closedTradeSummary";
import { getPortfolioSnapshot } from "@/lib/portfolio_snapshot";

export const dynamic = "force-dynamic";

type Portfolio = {
  id: string;
  user_id: string;
  name?: string | null;
  account_currency?: string | null;
  account_size?: number | null;
  cash_balance?: number | null;
  risk_per_trade?: number | null;
  max_positions?: number | null;
  default_fee_per_order?: number | null;
  is_default?: boolean | null;
};

type PositionRow = {
  id: string;
  portfolio_id: string;
  symbol: string;
  status: string;
  strategy_version?: string | null;
  max_hold_days?: number | null;
  tp_model?: string | null;
  tp_plan?: string | null;
  tp1_pct?: number | null;
  tp2_pct?: number | null;
  tp1_size_pct?: number | null;
  tp2_size_pct?: number | null;
  entry_date?: string | null;

  entry_price: number | null;
  entry_fee?: number | null;
  stop_price: number | null;

  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;

  created_at: string | null;

  closed_at: string | null;
  exit_price: number | null;
  exit_fee?: number | null;
  exit_reason?: string | null;
  exit_date?: string | null;
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

function makeSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in environment variables.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function fetchAndUpsertDailyBars(symbolRaw: string) {
  // Fallback-only targeted hydration for missing open-position symbols.
  // Not a replacement for the production daily refresh pipeline.
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

  const admin = makeSupabaseAdminClient();

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

  await admin.from("price_bars").upsert(rows, { onConflict: "symbol,date" });
}

export default async function PortfolioPage() {
  const supabase = await makeSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?next=/portfolio");

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

  // Latest prices for ALL open symbols (with auto-fetch)
  const uniqueSymbols = [
    ...new Set(
      open
        .map((p) => String(p.symbol ?? "").trim().toUpperCase())
        .filter(Boolean)
    ),
  ];
  const latestPriceBySymbol: Record<string, number | null> = {};
  const admin = makeSupabaseAdminClient();

  for (const symbol of uniqueSymbols) {
    const { data: latestRow } = await admin
      .from("price_bars")
      .select("close,date")
      .eq("symbol", symbol)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRow) {
      await fetchAndUpsertDailyBars(symbol);

      const { data: retryRow } = await admin
        .from("price_bars")
        .select("close,date")
        .eq("symbol", symbol)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      latestPriceBySymbol[symbol] = retryRow?.close ?? null;
    } else {
      latestPriceBySymbol[symbol] = latestRow.close ?? null;
    }
  }

  // Closed summary cards
  const closedSummary = computeClosedTradeSummary(
    closed.map((p) => ({
      symbol: p.symbol,
      entry_price: p.entry_price,
      exit_price: p.exit_price,
      entry_fee: p.entry_fee ?? null,
      exit_fee: p.exit_fee ?? null,
      shares: (p as any).shares ?? null,
      quantity: (p as any).quantity ?? null,
      position_size: (p as any).position_size ?? null,
      closed_at: p.closed_at,
    }))
  );

  // Realized stats (simple)
  let realizedPnL = 0;
  let realizedWins = 0;
  let realizedLosses = 0;

  for (const p of closed) {
    if (typeof p.entry_price !== "number" || typeof p.exit_price !== "number") continue;
    const qty = resolveQty(p);
    const fees = (typeof p.entry_fee === "number" ? p.entry_fee : 0) + (typeof p.exit_fee === "number" ? p.exit_fee : 0);
    const pnl = (p.exit_price - p.entry_price) * qty - fees;
    realizedPnL += pnl;
    if (pnl > 0) realizedWins += 1;
    if (pnl < 0) realizedLosses += 1;
  }

  const realizedTrades = realizedWins + realizedLosses;
  const winRate = realizedTrades ? realizedWins / realizedTrades : 0;

  const snapshot = await getPortfolioSnapshot(supabase as any, String(portfolio.id), false);

  // Exposure
  const deployedCostBasis = snapshot?.deployed_cost_basis ?? 0;
  let marketValue = 0;
  const debugLots = snapshot?.open_rows ?? [];
  const unknownOpenCount = snapshot?.unknown_open_positions_count ?? 0;
  for (const p of open) {
    const qty = resolveQty(p);
    const symbol = String(p.symbol ?? "").trim().toUpperCase();
    const last = symbol ? latestPriceBySymbol[symbol] : null;
    if (typeof last === "number" && Number.isFinite(last) && last > 0 && qty > 0) {
      marketValue += last * qty;
    }
  }

  const capitalDeployed = deployedCostBasis;
  let riskDeployed = 0;

  for (const p of open) {
    const entry = p.entry_price;
    const stop = p.stop_price;
    const qty = resolveQty(p);
    if (typeof entry === "number" && entry > 0 && typeof stop === "number" && stop > 0 && qty > 0) {
      riskDeployed += Math.max(0, (entry - stop) * qty);
    }
  }

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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Open exposure</div>
          <div className="mt-1 text-sm text-slate-800">
            Capital deployed (cost basis): <span className="font-semibold">{formatMoney(capitalDeployed)}</span>
          </div>
          <div className="mt-1 text-sm text-slate-800">
            Open count: <span className="font-semibold">{open.length}</span>
          </div>
          <div className="mt-1 text-sm text-slate-800">
            Risk deployed: <span className="font-semibold">{formatMoney(riskDeployed)}</span>
          </div>
          <div className="mt-1 text-sm text-slate-800">
            Market value: <span className="font-semibold">{formatMoney(marketValue)}</span>
          </div>
          {unknownOpenCount > 0 ? (
            <div className="mt-1 text-xs text-amber-700">
              {unknownOpenCount} open position(s) missing entry/qty excluded from deployed math.
            </div>
          ) : null}
          <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
            <summary className="cursor-pointer text-xs text-slate-600">Debug cost-basis contributions</summary>
            <div className="mt-2 space-y-1 text-xs font-mono text-slate-700">
              {debugLots.map((lot, idx) => (
                <div key={`${lot.symbol}-${idx}`}>
                  {lot.symbol || "—"} | qty={Number.isFinite(lot.qty) ? lot.qty : "—"} | entry=
                  {lot.entry_price == null ? "—" : lot.entry_price.toFixed(4)} | contrib=
                  {lot.contribution == null ? "—" : lot.contribution.toFixed(2)}
                </div>
              ))}
              <div className="pt-1 font-semibold">
                TOTAL = {formatMoney(capitalDeployed)}
              </div>
            </div>
          </details>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Realized performance</div>
          <div className="mt-1 text-sm text-slate-800">
            Realized Net P/L: <span className="font-semibold">{formatMoney(realizedPnL)}</span>
          </div>
          <div className="mt-1 text-sm text-slate-800">
            Win rate: <span className="font-semibold">{(winRate * 100).toFixed(0)}%</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{realizedTrades} closed trades</div>
        </div>

      </div>

      <PositionsClient
        openPositions={open as any}
        closedPositions={closed as any}
        closedSummary={closedSummary}
        latestPriceBySymbol={latestPriceBySymbol}
        defaultFeePerOrder={typeof portfolio.default_fee_per_order === "number" ? portfolio.default_fee_per_order : null}
      />
    </div>
  );
}
