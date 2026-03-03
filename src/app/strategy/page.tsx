import Link from "next/link";

export default function StrategyPage() {
  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6 text-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Strategy & Logic</div>
          <div className="text-sm text-slate-600">
            What the platform is optimizing for, and how to use the signals with discipline.
          </div>
        </div>

        <Link
          href="/screener"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 whitespace-nowrap"
        >
          <span aria-hidden="true">←</span>
          Back to Screener
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">0) Universe</div>
        <div className="text-sm text-slate-700">
          The screener scans <b>Liquid 2000</b>: approximately the <b>top 2000 most liquid US stocks</b> by dollar volume.
          This increases opportunity while keeping the system focused on tradable names.
        </div>
        <div className="text-sm text-slate-700">
          The strategy remains a <b>daily swing system</b> (typically days to a few weeks), not long-term investing.
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
        <div className="text-lg font-semibold">2) Signals</div>
        <div className="text-sm text-slate-700">
          Indicators (daily): SMA20/50/200, RSI(14), ATR(14), and volume confirmation.
        </div>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
          <li>
            <b>BUY</b> is intentionally rare: trend alignment (above SMA50 &amp; SMA200), healthy RSI zone, volume confirmation, and confidence threshold.
          </li>
          <li>
            <b>WATCH</b> means the setup is interesting but missing one or more BUY requirements.
          </li>
          <li>
            <b>AVOID</b> means weak trend or low confidence for this strategy.
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="text-lg font-semibold">3) Entry & Stop</div>
        <div className="text-sm text-slate-700">
          <b>Entry</b> is the reference price (from daily bars). <b>Stop</b> is the recommended invalidation level (ATR-based by default).
        </div>
        <div className="text-sm text-slate-700">
          The platform does not place broker orders. It gives you a plan to execute with discipline.
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
        <div className="text-lg font-semibold">7) Capital management</div>
        <div className="text-sm text-slate-700">
          The platform uses your portfolio <b>account size</b> for sizing and exposure calculations. If you add capital,
          update account size so position sizing scales accordingly.
        </div>
        <div className="text-sm text-slate-700">
          A future upgrade can add “capital deployed” guardrails to warn/block over-allocation when your account is heavily deployed.
        </div>
      </section>
    </div>
  );
}