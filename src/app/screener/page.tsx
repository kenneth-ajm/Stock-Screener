import { supabaseServer } from "@/lib/supabase/server";

export default async function ScreenerPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  const { data: defaultPortfolio } = await supabase
    .from("portfolios")
    .select("id, name, account_currency, account_size, risk_per_trade, max_positions, is_default")
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();

  const { data: regimeRows } = await supabase
    .from("market_regime")
    .select("date, state, close, sma200")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  const regime = regimeRows?.[0] ?? null;

  const { data: latestScan } = await supabase
    .from("daily_scans")
    .select("date")
    .eq("universe_slug", "core_400")
    .eq("strategy_version", "v1")
    .order("date", { ascending: false })
    .limit(1);

  const latestScanDate = latestScan?.[0]?.date ?? null;

  let scanRows: any[] = [];
  if (latestScanDate) {
    const { data: rows } = await supabase
      .from("daily_scans")
      .select("date, symbol, signal, confidence, entry, stop, tp1, tp2")
      .eq("universe_slug", "core_400")
      .eq("strategy_version", "v1")
      .eq("date", latestScanDate)
      .order("confidence", { ascending: false })
      .limit(50);

    scanRows = rows ?? [];
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Screener</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Logged in as: {data.user?.email}
        </p>
      </div>

      <div className="rounded-2xl border p-4 bg-white/50">
        <div className="font-medium">Active portfolio</div>
        {defaultPortfolio ? (
          <div className="mt-2 text-sm">
            <div className="font-semibold">{defaultPortfolio.name}</div>
            <div className="text-muted-foreground">
              {defaultPortfolio.account_currency} {Number(defaultPortfolio.account_size).toFixed(0)} | risk/trade{" "}
              {defaultPortfolio.risk_per_trade} | max positions {defaultPortfolio.max_positions}
            </div>
            <a className="underline text-sm" href="/portfolio">
              Manage portfolios
            </a>
          </div>
        ) : (
          <div className="mt-2 text-sm text-muted-foreground">
            No default portfolio found. Go to <a className="underline" href="/portfolio">/portfolio</a>.
          </div>
        )}
      </div>

      <div className="rounded-2xl border p-4 bg-white/50">
        <div className="font-medium">Utilities</div>
        <div className="mt-4 flex flex-wrap gap-3">
          <form action="/api/ingest" method="post">
            <button className="rounded-xl border px-4 py-2">Ingest SPY</button>
          </form>
          <form action="/api/regime" method="post">
            <button className="rounded-xl border px-4 py-2">Calculate SPY Regime</button>
          </form>
          <form action="/api/ingest-universe" method="post">
            <button className="rounded-xl border px-4 py-2">Ingest core_400 (test 10)</button>
          </form>
          <form action="/api/scan" method="post">
            <button className="rounded-xl border px-4 py-2">Run Daily Scan</button>
          </form>
        </div>
      </div>

      <div className="rounded-2xl border p-4 bg-white/50">
        <div className="font-medium">Market Regime (SPY)</div>
        {regime ? (
          <div className="mt-2 text-sm">
            <div>Date: <span className="font-mono">{regime.date}</span></div>
            <div>State: <span className="font-semibold">{regime.state}</span></div>
            <div className="text-muted-foreground">
              Close: {Number(regime.close).toFixed(2)} | SMA200: {Number(regime.sma200).toFixed(2)}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-muted-foreground">No regime record yet.</div>
        )}
      </div>

      <div className="rounded-2xl border p-4 bg-white/50">
        <div className="font-medium">Latest Scan Results (core_400)</div>
        {!latestScanDate ? (
          <div className="mt-2 text-sm text-muted-foreground">No scan results yet.</div>
        ) : (
          <>
            <div className="mt-2 text-sm text-muted-foreground">
              Showing results for <span className="font-mono">{latestScanDate}</span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[900px] w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Symbol</th>
                    <th className="py-2 pr-4">Signal</th>
                    <th className="py-2 pr-4">Confidence</th>
                    <th className="py-2 pr-4">Entry</th>
                    <th className="py-2 pr-4">Stop</th>
                    <th className="py-2 pr-4">TP1</th>
                    <th className="py-2 pr-4">TP2</th>
                  </tr>
                </thead>
                <tbody>
                  {scanRows.map((r) => (
                    <tr key={r.symbol} className="border-b">
                      <td className="py-2 pr-4 font-mono">{r.symbol}</td>
                      <td className="py-2 pr-4 font-semibold">{r.signal}</td>
                      <td className="py-2 pr-4">{r.confidence}</td>
                      <td className="py-2 pr-4">{r.entry == null ? "-" : Number(r.entry).toFixed(2)}</td>
                      <td className="py-2 pr-4">{r.stop == null ? "-" : Number(r.stop).toFixed(2)}</td>
                      <td className="py-2 pr-4">{r.tp1 == null ? "-" : Number(r.tp1).toFixed(2)}</td>
                      <td className="py-2 pr-4">{r.tp2 == null ? "-" : Number(r.tp2).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}