type RegimeResult = {
  ok: boolean;
  state: "FAVORABLE" | "DEFENSIVE" | null;
  regime_date_used: string | null;
  regime_stale: boolean;
  error?: string;
};

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export async function refreshSpyRegimeForLctd(opts: {
  supabase: any;
  lctd: string;
}): Promise<RegimeResult> {
  const supa = opts.supabase as any;
  try {
    const { data: bars, error: barsErr } = await supa
      .from("price_bars")
      .select("date,close")
      .eq("symbol", "SPY")
      .lte("date", opts.lctd)
      .order("date", { ascending: false })
      .limit(260);
    if (barsErr) throw barsErr;
    if (!bars || bars.length === 0) {
      return {
        ok: false,
        state: null,
        regime_date_used: null,
        regime_stale: true,
        error: "No SPY bars available",
      };
    }

    const latest = bars[0];
    const regimeDateUsed = String(latest.date);
    const stale = regimeDateUsed < opts.lctd;
    if (bars.length < 200) {
      return {
        ok: false,
        state: null,
        regime_date_used: regimeDateUsed,
        regime_stale: true,
        error: "Not enough SPY bars to compute SMA200",
      };
    }

    const asc = [...bars].reverse();
    const closes = asc.map((r: any) => Number(r.close));
    const sma200 = sma(closes, 200);
    const close = Number(latest.close);
    if (!sma200 || !Number.isFinite(close)) {
      return {
        ok: false,
        state: null,
        regime_date_used: regimeDateUsed,
        regime_stale: true,
        error: "Unable to compute SPY regime",
      };
    }
    const state: "FAVORABLE" | "DEFENSIVE" = close > sma200 ? "FAVORABLE" : "DEFENSIVE";
    const nowIso = new Date().toISOString();

    const writeWithMeta = await supa.from("market_regime").upsert(
      {
        symbol: "SPY",
        date: regimeDateUsed,
        close,
        sma200,
        state,
        source: "computed",
        updated_at: nowIso,
      },
      { onConflict: "symbol,date" }
    );
    if (writeWithMeta.error) {
      // Fallback if metadata columns are not migrated yet.
      const writeBasic = await supa.from("market_regime").upsert(
        {
          symbol: "SPY",
          date: regimeDateUsed,
          close,
          sma200,
          state,
        },
        { onConflict: "symbol,date" }
      );
      if (writeBasic.error) throw writeBasic.error;
    }

    return {
      ok: true,
      state,
      regime_date_used: regimeDateUsed,
      regime_stale: stale,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      state: null,
      regime_date_used: null,
      regime_stale: true,
      error: e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e),
    };
  }
}

