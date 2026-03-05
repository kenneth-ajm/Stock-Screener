export type LctdSource = "spy_max_date" | "global_max_date" | "none";

export async function getLCTD(supabase: any): Promise<{
  lctd: string | null;
  source: LctdSource;
}> {
  const supa = supabase as any;

  const { data: spyData, error: spyErr } = await supa
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);
  if (!spyErr && spyData?.[0]?.date) {
    return { lctd: String(spyData[0].date), source: "spy_max_date" };
  }

  const { data: anyData, error: anyErr } = await supa
    .from("price_bars")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);
  if (!anyErr && anyData?.[0]?.date) {
    return { lctd: String(anyData[0].date), source: "global_max_date" };
  }

  return { lctd: null, source: "none" };
}

export async function getLatestScanDatesByStrategy(supabase: any, universe_slug: string) {
  const supa = supabase as any;
  const { data, error } = await supa
    .from("daily_scans")
    .select("date,strategy_version")
    .eq("universe_slug", universe_slug)
    .order("date", { ascending: false })
    .limit(5000);

  if (error) {
    return {
      ok: false as const,
      error: error.message,
      latest_by_strategy: {} as Record<string, string>,
    };
  }

  const latestByStrategy = new Map<string, string>();
  for (const row of data ?? []) {
    const strategy = String(row.strategy_version ?? "");
    const date = String(row.date ?? "");
    if (!strategy || !date) continue;
    const prev = latestByStrategy.get(strategy);
    if (!prev || date > prev) latestByStrategy.set(strategy, date);
  }

  return {
    ok: true as const,
    error: null,
    latest_by_strategy: Object.fromEntries(latestByStrategy.entries()),
  };
}

export function getFreshnessStatus(opts: {
  lctd: string | null;
  latestScanDate: string | null;
  regimeDate: string | null;
}) {
  const expected = opts.lctd;
  const latest = opts.latestScanDate ? String(opts.latestScanDate) : null;
  const regimeDate = opts.regimeDate ? String(opts.regimeDate) : null;
  const reasons: string[] = [];

  if (!expected) {
    reasons.push("LCTD unavailable");
  }
  if (!latest) {
    reasons.push("No scan rows");
  } else if (expected && latest !== expected) {
    reasons.push(`Latest scan ${latest} != expected ${expected}`);
  }
  if (!regimeDate) {
    reasons.push("Regime missing");
  } else if (expected && regimeDate !== expected) {
    reasons.push(`Regime date ${regimeDate} != expected ${expected}`);
  }

  return {
    is_stale: reasons.length > 0,
    reasons,
    expected_date: expected ?? "",
    latest_scan_date: latest,
    regime_date: regimeDate,
  };
}

