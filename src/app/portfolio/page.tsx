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

async function makeSupabaseServerClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}

async function fetchAndUpsertDailyBars(symbol: string) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return;

  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const from = fromDate.toISOString().slice(0, 10);

  const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}?adjusted=false&sort=asc&apiKey=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) return;

  const json = await res.json();
  if (!json?.results?.length) return;

  const supabase = await makeSupabaseServerClient();

  const rows = json.results.map((r: any) => ({
    symbol,
    date: new Date(r.t).toISOString().slice(0, 10),
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: Math.round(r.v),
    source: "polygon",
  }));

  await supabase.from("price_bars").upsert(rows, {
    onConflict: "symbol,date",
  });
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
      <div className="mx-auto max-w-6xl p-6">
        No default portfolio found.
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

  // 🔵 AUTO-FETCH LATEST PRICES
  const uniqueSymbols = [...new Set(open.map((p) => p.symbol))];

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

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6 text-slate-900">
      <PositionsClient
        openPositions={open as any}
        closedPositions={closed as any}
        closedSummary={closedSummary}
        latestPriceBySymbol={latestPriceBySymbol}
      />
    </div>
  );
}