import Link from "next/link";
import BacktestClient from "./BacktestClient";
import MomentumBackfillClient from "./MomentumBackfillClient";
import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import { getLCTD } from "@/lib/scan_status";
import { computeSectorMomentum } from "@/lib/sector_momentum";

function fmtPct(v: number) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

export default async function StrategyPage() {
  const { user, portfolios, supabase } = await getWorkspaceContext("/strategy");
  const lctd = await getLCTD(supabase as any);
  const sectorMomentum = await computeSectorMomentum({
    supabase: supabase as any,
    scan_date: lctd.lctd,
    lctd_source: lctd.source,
  });
  const topGroups = sectorMomentum.groups.slice(0, 8);
  return (
    <AppShell currentPath="/strategy" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="mx-auto max-w-4xl space-y-6 text-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold tracking-tight">Strategy & Logic</div>
            <div className="text-sm text-slate-600">
              What the platform is optimizing for, and how to use the signals with discipline.
            </div>
          </div>
          <Link
            href="/ideas"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 whitespace-nowrap"
          >
            <span aria-hidden="true">←</span>
            Back to Ideas
          </Link>
        </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">0) Universe</div>
        <div className="text-sm text-slate-700">
          The default universe is <b>Core 800</b> (or Core 600 for tighter selection): US equities, daily timeframe, long-only.
        </div>
        <div className="text-sm text-slate-700">
          Liquidity is enforced in the signal engine: average dollar volume must be at least <b>$50M/day</b>.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">1) Market regime (SPY)</div>
        <div className="text-sm text-slate-700">
          We compute SPY SMA200 using <b>Polygon daily bars</b>. If <b>SPY close &gt; SMA200</b>, regime is{" "}
          <b>FAVORABLE</b>. Otherwise <b>DEFENSIVE</b>.
        </div>
        <div className="text-sm text-slate-700">
          In DEFENSIVE regime, the system becomes more cautious and may downgrade BUY → WATCH.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">2) Signal rules</div>
        <div className="text-sm text-slate-700">
          This is a strict <b>momentum continuation</b> model: strong trend + controlled pullback + resumption.
        </div>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
          <li><b>BUY</b> requires all: Close &gt; SMA50 and SMA200, SMA20 &gt; SMA50, SMA50 rising, RSI 50–65, volume spike ≥ 1.2x, and distance from SMA20 ≤ 1.5 ATR.</li>
          <li><b>WATCH</b> requires: Close &gt; SMA50, trend aligned (above/reclaimed SMA200), RSI 45–70, volume spike ≥ 1.1x, and distance from SMA20 ≤ 2.0 ATR.</li>
          <li><b>Regime gate</b>: if SPY regime is DEFENSIVE, BUY is downgraded to WATCH.</li>
          <li><b>Global caps</b> per day/universe: BUY ≤ 5 and WATCH ≤ 10 (overflow downgrades deterministically).</li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">3) Trade plan</div>
        <div className="text-sm text-slate-700">
          <b>Entry</b> is latest close. <b>Stop</b> is standardized to <b>8% below entry</b>.
        </div>
        <div className="text-sm text-slate-700">
          Targets are fixed at <b>TP1 = +5%</b> and <b>TP2 = +10%</b> with max holding period <b>7 trading days</b>.
          Suggested management is 50% off at TP1 and remainder at TP2.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">4) Position sizing (risk per trade)</div>
        <div className="text-sm text-slate-700">
          <b>Risk per trade</b> is the max % of account you’re willing to lose if price hits the stop.
        </div>
        <div className="text-sm text-slate-700">
          Example: account size $10,000 and risk/trade 2% → max loss ≈ $200. If entry-stop distance is $4,
          size ≈ $200 / $4 = 50 shares.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">5) Live prices</div>
        <div className="text-sm text-slate-700">
          The Screener can show a <b>live price overlay</b> for context. This does <b>not</b> change the daily signal logic.
        </div>
        <div className="text-sm text-slate-700">
          Signals remain daily, cached scan results. Live prices are for situational awareness only.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">6) Max positions</div>
        <div className="text-sm text-slate-700">
          <b>Max positions</b> is a portfolio risk guardrail. It limits how many open positions you allow at once.
          It does not change the BUY/WATCH/AVOID logic.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold">8) Sector Momentum (Phase 1)</div>
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
            New strategy label
          </span>
        </div>
        <div className="text-sm text-slate-700">
          Discovery-only industry-group ranking using short-term relative strength, participation, and volume expansion.
        </div>
        <div className="text-xs text-slate-500">
          As of {sectorMomentum.scan_date ?? "—"} ({sectorMomentum.lctd_source})
        </div>
        {!sectorMomentum.ok ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Sector Momentum ranking unavailable: {sectorMomentum.error ?? "unknown"}
          </div>
        ) : (
          <div className="space-y-2">
            {topGroups.map((g) => (
              <div key={g.key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{g.name}</div>
                    <div className="text-xs text-slate-500">{g.theme}</div>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                      g.state === "LEADING"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : g.state === "IMPROVING"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {g.state}
                  </span>
                </div>
                <div className="mt-1 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
                  <div>RS 5d: <span className="font-semibold">{fmtPct(g.rs_5d)}</span></div>
                  <div>RS 10d: <span className="font-semibold">{fmtPct(g.rs_10d)}</span></div>
                  <div>Vol exp: <span className="font-semibold">{g.avg_volume_expansion.toFixed(2)}x</span></div>
                  <div>%&gt;SMA20: <span className="font-semibold">{g.pct_above_sma20.toFixed(0)}%</span></div>
                  <div>%&gt;SMA50: <span className="font-semibold">{g.pct_above_sma50.toFixed(0)}%</span></div>
                  <div>Score: <span className="font-semibold">{g.rank_score.toFixed(1)}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">7) Capital management</div>
        <div className="text-sm text-slate-700">
          The platform uses your portfolio <b>account size</b> for sizing and exposure calculations. If you add capital,
          update account size so position sizing scales accordingly.
        </div>
        <div className="text-sm text-slate-700">
          A future upgrade can add “capital deployed” guardrails to warn/block over-allocation when your account is heavily deployed.
        </div>
      </section>

        <BacktestClient />
        <MomentumBackfillClient />
      </div>
    </AppShell>
  );
}
