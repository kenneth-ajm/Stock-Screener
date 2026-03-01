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

  // sizing (your schema might use one of these)
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
  // In your Next setup, cookies() is async
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env."
    );
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
          // In Server Components, setting cookies can fail during render.
          // That’s OK for our usage.
        }
      },
    },
  });
}

export default async function PortfolioPage() {
  // IMPORTANT: await here, otherwise supabase is a Promise and TS complains
  const supabase = await makeSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?next=/portfolio");
  }

  // 1) Load default portfolio
  const { data: portfolio, error: pErr } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .maybeSingle<Portfolio>();

  if (pErr) {
    return (
      <div className="p-6">
        <div className="text-sm text-rose-200">
          Error loading portfolio: {pErr.message}
        </div>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="p-6 space-y-3">
        <div className="text-xl font-semibold">Portfolio</div>
        <div className="text-sm text-white/60">
          No default portfolio found yet.
        </div>
        <Link
          className="inline-block rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
          href="/screener"
        >
          Back to Screener
        </Link>
      </div>
    );
  }

  // 2) Fetch positions
  // If your DB uses lowercase statuses, change "OPEN"/"CLOSED" to match.
  const { data: openPositions, error: oErr } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("portfolio_id", portfolio.id)
    .eq("status", "OPEN")
    .order("created_at", { ascending: false })
    .returns<PositionRow[]>();

  const { data: closedPositions, error: cErr } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("portfolio_id", portfolio.id)
    .eq("status", "CLOSED")
    .order("closed_at", { ascending: false })
    .returns<PositionRow[]>();

  if (oErr || cErr) {
    return (
      <div className="p-6">
        <div className="text-sm text-rose-200">
          Error loading positions: {(oErr?.message ?? "") + " " + (cErr?.message ?? "")}
        </div>
      </div>
    );
  }

  const open = openPositions ?? [];
  const closed = closedPositions ?? [];

  // 3) Realized stats (basic)
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

  // 4) Closed Summary Cards
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

  // 5) Open exposure
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
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Portfolio</div>
          <div className="text-sm text-white/60">
            Default journey{portfolio.name ? `: ${portfolio.name}` : ""}
          </div>
        </div>

        <Link
          href="/screener"
          className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15 whitespace-nowrap"
        >
          Back to Screener
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Open exposure</div>
          <div className="mt-1 text-sm text-white/80">
            Capital deployed:{" "}
            <span className="font-semibold">{formatMoney(capitalDeployed)}</span>
          </div>
          <div className="mt-1 text-sm text-white/80">
            Risk deployed:{" "}
            <span className="font-semibold">{formatMoney(riskDeployed)}</span>
          </div>
          <div className="mt-1 text-xs text-white/50">
            {pctDeployed !== null
              ? `${(pctDeployed * 100).toFixed(1)}% of account size`
              : "—"}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Realized performance</div>
          <div className="mt-1 text-sm text-white/80">
            Realized P/L:{" "}
            <span className="font-semibold">{formatMoney(realizedPnL)}</span>
          </div>
          <div className="mt-1 text-sm text-white/80">
            Win rate:{" "}
            <span className="font-semibold">{(winRate * 100).toFixed(0)}%</span>
          </div>
          <div className="mt-1 text-xs text-white/50">
            {realizedTrades} closed trades
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Account</div>
          <div className="mt-1 text-sm text-white/80">
            Size: <span className="font-semibold">{formatMoney(acctSize)}</span>
          </div>
          <div className="mt-1 text-xs text-white/50">
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