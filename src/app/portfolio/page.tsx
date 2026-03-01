import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import PositionsClient from "./PositionsClient";
import { computeClosedTradeSummary } from "@/lib/analytics/closedTradeSummary";

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
          // OK in Server Components
        }
      },
    },
  });
}

export default async function PortfolioPage() {
  const supabase = await makeSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?next=/portfolio");
  }

  const { data: portfolio, error: pErr } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .maybeSingle<Portfolio>();

  if (pErr) {
    return (
      <div className="p-6 text-slate-900">
        <div className="text-sm text-rose-600">Error loading portfolio: {pErr.message}</div>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="mx-auto max-w-6xl p-6 space-y-3 text-slate-900">
        <div className="text-xl font-semibold">Portfolio</div>
        <div className="text-sm text-slate-600">No default portfolio found yet.</div>
        <Link
          className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          href="/screener"
        >
          Back to Screener
        </Link>
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

  // realized stats
  let realizedPnL = 0;
  let realizedWins = 0;
  let realizedLosses = 0;

  for (const p of closed) {
    if (typeof p.entry_price !== "number" || typeof p.exit_price !== "number") continue;

    const qty =
      (typeof p.shares === "number" ? p.shares : null) ??
      (typeof p.quantity === "number" ? p.quantity : null) ??
      (typeof p.position_size === "number" ? p.position_size : null) ??
      0;

    const pnl = (p.exit_price - p.entry_price) * (qty ?? 0);
    realizedPnL += pnl;
    if (pnl > 0) realizedWins += 1;
    if (pnl < 0) realizedLosses += 1;
  }

  const realizedTrades = realizedWins + realizedLosses;
  const winRate = realizedTrades ? realizedWins / realizedTrades : 0;

  const closedSummary = computeClosedTradeSummary(
    closed.map((p: PositionRow) => ({
      symbol: p.symbol,
      entry_price: p.entry_price,
      exit_price: p.exit_price,
      shares: p.shares ?? null,
      quantity: p.quantity ?? null,
      position_size: p.position_size ?? null,
      closed_at: p.closed_at,
    }))
  );

  // open exposure
  let capitalDeployed = 0;
  let riskDeployed = 0;

  for (const p of open) {
    const entry = p.entry_price;
    const stop = p.stop_price;
    const qty =
      (typeof p.shares === "number" ? p.shares : null) ??
      (typeof p.quantity === "number" ? p.quantity : null) ??
      (typeof p.position_size === "number" ? p.position_size : null) ??
      0;

    if (typeof entry === "number" && entry > 0 && typeof qty === "number" && qty > 0) {
      capitalDeployed += entry * qty;
    }
    if (
      typeof entry === "number" &&
      typeof stop === "number" &&
      entry > 0 &&
      typeof qty === "number" &&
      qty > 0
    ) {
      riskDeployed += Math.max(0, (entry - stop) * qty);
    }
  }

  const acctSize = portfolio.account_size ?? null;
  const pctDeployed =
    typeof acctSize === "number" && acctSize > 0 ? capitalDeployed / acctSize : null;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6 text-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Portfolio</div>
          <div className="text-sm text-slate-600">
            Default journey{portfolio.name ? `: ${portfolio.name}` : ""}
          </div>
        </div>

        <Link
          href="/screener"
          className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          Back to Screener
        </Link>
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
          <div className="mt-1 text-xs text-slate-500">
            Currency: {portfolio.account_currency ?? "—"}
          </div>
        </div>
      </div>

      <PositionsClient
        openPositions={open as any}
        closedPositions={closed as any}
        closedSummary={closedSummary}
      />
    </div>
  );
}