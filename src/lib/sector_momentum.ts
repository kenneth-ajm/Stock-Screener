import type { LctdSource } from "@/lib/scan_status";
import { buildTechnicalTargets } from "@/lib/target_engine";

export type IndustryGroup = {
  key: string;
  name: string;
  theme: string;
  symbols: string[];
};

export type SectorMomentumState = "LEADING" | "IMPROVING" | "WEAK";

export type SectorMomentumRow = {
  key: string;
  name: string;
  theme: string;
  symbols_count: number;
  symbols_used: number;
  rs_5d: number;
  rs_10d: number;
  avg_volume_expansion: number;
  pct_above_sma20: number;
  pct_above_sma50: number;
  pct_above_sma200: number;
  breakout_participation: number;
  trend_persistence: number;
  rank_score: number;
  state: SectorMomentumState;
};

export type SectorMomentumResult = {
  ok: boolean;
  scan_date: string | null;
  lctd_source: LctdSource | "none";
  groups: SectorMomentumRow[];
  error?: string;
};

export const SECTOR_MOMENTUM_STRATEGY_VERSION = "v1_sector_momentum";
export const SECTOR_MOMENTUM_UNIVERSE_SLUG = "growth_1500";

type PriceBarLite = {
  symbol: string;
  date: string;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CandidateSignal = "BUY" | "WATCH" | "AVOID";

export type SectorMomentumCandidate = {
  symbol: string;
  industry_group: string;
  theme: string;
  signal: CandidateSignal;
  confidence: number;
  rank_score: number;
  rank: number | null;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  reason_summary: string;
  reason_json: Record<string, unknown>;
};

const LOOKBACK_DAYS = 220;

export const INDUSTRY_GROUPS: IndustryGroup[] = [
  {
    key: "semiconductors",
    name: "Semiconductors",
    theme: "AI Hardware",
    symbols: ["NVDA", "AMD", "AVGO", "MU", "ON", "MRVL", "QCOM", "TXN", "ADI", "NXPI", "AMAT", "LRCX", "KLAC", "MCHP", "TER"],
  },
  {
    key: "cybersecurity",
    name: "Cybersecurity",
    theme: "Security Software",
    symbols: ["CRWD", "PANW", "ZS", "FTNT", "CYBR", "S", "OKTA", "RPD", "TENB", "NET", "AKAM", "QLYS"],
  },
  {
    key: "cloud_software",
    name: "Cloud Software",
    theme: "SaaS Leaders",
    symbols: ["MSFT", "CRM", "NOW", "SNOW", "DDOG", "MDB", "HUBS", "TEAM", "WDAY", "SHOP", "ADBE", "ORCL", "INTU", "SMCI"],
  },
  {
    key: "defense",
    name: "Defense",
    theme: "Aerospace & Defense",
    symbols: ["LMT", "NOC", "RTX", "GD", "LHX", "BA", "TDG", "HII", "KTOS", "TXT", "CW", "HEI"],
  },
  {
    key: "biotech",
    name: "Biotech",
    theme: "Biotech Innovators",
    symbols: ["REGN", "VRTX", "ALNY", "BIIB", "MRNA", "GILD", "INCY", "SRPT", "EXEL", "BMRN", "NBIX", "RGEN"],
  },
  {
    key: "pharma",
    name: "Pharma",
    theme: "Large Pharma",
    symbols: ["LLY", "NVO", "JNJ", "PFE", "MRK", "BMY", "ABBV", "AZN", "GSK", "SNY", "ZTS"],
  },
  {
    key: "oil_gas",
    name: "Oil & Gas",
    theme: "Integrated Energy",
    symbols: ["XOM", "CVX", "COP", "EOG", "OXY", "DVN", "FANG", "MRO", "APA", "PXD", "HES", "EQT"],
  },
  {
    key: "oil_services",
    name: "Oil Services",
    theme: "Energy Services",
    symbols: ["SLB", "HAL", "BKR", "NOV", "FTI", "CHX", "NBR", "RIG", "HP", "PUMP", "LBRT"],
  },
  { key: "uranium", name: "Uranium", theme: "Nuclear Fuel", symbols: ["CCJ", "UEC", "UUUU", "NXE", "DNN", "LEU", "EU", "URG"] },
  { key: "solar", name: "Solar", theme: "Solar Buildout", symbols: ["FSLR", "ENPH", "SEDG", "RUN", "NXT", "ARRY", "CSIQ", "SHLS"] },
  {
    key: "brokers",
    name: "Brokers",
    theme: "Capital Markets",
    symbols: ["SCHW", "IBKR", "HOOD", "MS", "GS", "RJF", "SF", "LPLA", "JEF", "NDAQ", "CBOE"],
  },
  {
    key: "insurers",
    name: "Insurers",
    theme: "Insurance",
    symbols: ["PGR", "CB", "ALL", "TRV", "AIG", "MET", "PRU", "AFL", "HIG", "CINF", "WRB"],
  },
  {
    key: "homebuilders",
    name: "Homebuilders",
    theme: "Housing Cycle",
    symbols: ["DHI", "LEN", "NVR", "PHM", "TOL", "MTH", "KBH", "BZH", "TMHC", "BLD", "MAS"],
  },
  {
    key: "machinery_industrials",
    name: "Machinery / Industrials",
    theme: "Industrial Expansion",
    symbols: ["CAT", "DE", "ETN", "PH", "ROK", "EMR", "ITW", "TT", "XYL", "PCAR", "CMI", "IR"],
  },
  {
    key: "metals_miners",
    name: "Metals / Miners",
    theme: "Materials",
    symbols: ["FCX", "NEM", "SCCO", "AA", "CLF", "TECK", "MP", "X", "NUE", "STLD", "CMC", "GOLD"],
  },
];

function toNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function sma(values: number[], length: number) {
  if (values.length < length) return null;
  const slice = values.slice(values.length - length);
  return avg(slice);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function lookbackReturn(closes: number[], lookback: number) {
  const lb = Math.min(Math.max(1, lookback), closes.length - 1);
  if (closes.length <= lb) return 0;
  const latest = closes[closes.length - 1] ?? 0;
  const base = closes[closes.length - 1 - lb] ?? 0;
  if (!(latest > 0) || !(base > 0)) return 0;
  return latest / base - 1;
}

function barsBySymbol(rows: any[]): Map<string, PriceBarLite[]> {
  const out = new Map<string, PriceBarLite[]>();
  for (const row of rows) {
    const symbol = String(row?.symbol ?? "").trim().toUpperCase();
    const date = String(row?.date ?? "");
    const high = toNum(row?.high);
    const low = toNum(row?.low);
    const close = toNum(row?.close);
    const volume = toNum(row?.volume);
    if (!symbol || !date || high == null || low == null || close == null || volume == null) continue;
    if (!out.has(symbol)) out.set(symbol, []);
    out.get(symbol)!.push({ symbol, date, high, low, close, volume });
  }
  for (const [, bars] of out) {
    bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return out;
}

function stateForRow(row: SectorMomentumRow): SectorMomentumState {
  if (
    row.rs_5d >= 0.008 &&
    row.rs_10d >= 0.015 &&
    row.pct_above_sma20 >= 60 &&
    row.pct_above_sma50 >= 60 &&
    row.pct_above_sma200 >= 45 &&
    row.breakout_participation >= 30 &&
    row.trend_persistence >= 55
  ) {
    return "LEADING";
  }
  if (
    row.rs_10d >= 0 &&
    row.pct_above_sma20 >= 45 &&
    row.pct_above_sma50 >= 45 &&
    row.pct_above_sma200 >= 30 &&
    row.trend_persistence >= 40
  ) {
    return "IMPROVING";
  }
  return "WEAK";
}

export async function computeSectorMomentum(opts: {
  supabase: any;
  scan_date: string | null;
  lctd_source?: LctdSource | "none";
}): Promise<SectorMomentumResult> {
  const supa = opts.supabase as any;
  const scanDate = opts.scan_date ?? null;
  if (!scanDate) {
    return { ok: false, scan_date: null, lctd_source: opts.lctd_source ?? "none", groups: [], error: "Missing scan date" };
  }

  const from = new Date(`${scanDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - LOOKBACK_DAYS);
  const fromDate = isoDate(from);
  const allSymbols = Array.from(
    new Set(INDUSTRY_GROUPS.flatMap((g) => g.symbols).concat(["SPY"]).map((s) => s.trim().toUpperCase()))
  );

  const { data, error } = await supa
    .from("price_bars")
    .select("symbol,date,high,low,close,volume,source")
    .in("symbol", allSymbols)
    .eq("source", "polygon")
    .gte("date", fromDate)
    .lte("date", scanDate)
    .order("date", { ascending: true });
  if (error) {
    return {
      ok: false,
      scan_date: scanDate,
      lctd_source: opts.lctd_source ?? "none",
      groups: [],
      error: error.message,
    };
  }

  const bySymbol = barsBySymbol(Array.isArray(data) ? data : []);
  const spyBars = bySymbol.get("SPY") ?? [];
  if (spyBars.length < 3) {
    return {
      ok: false,
      scan_date: scanDate,
      lctd_source: opts.lctd_source ?? "none",
      groups: [],
      error: "Not enough SPY bars for relative-strength baseline",
    };
  }

  const spyCloses = spyBars.map((b) => b.close);
  const spyRet5 = lookbackReturn(spyCloses, 5);
  const spyRet10 = lookbackReturn(spyCloses, 10);

  const groups: SectorMomentumRow[] = [];
  for (const group of INDUSTRY_GROUPS) {
    const rs5: number[] = [];
    const rs10: number[] = [];
    const volExp: number[] = [];
    const above20: boolean[] = [];
    const above50: boolean[] = [];
    const above200: boolean[] = [];
    const breakoutParticipants: boolean[] = [];
    const trendPersistent: boolean[] = [];

    for (const symbol of group.symbols) {
      const bars = bySymbol.get(symbol.trim().toUpperCase()) ?? [];
      if (bars.length < 3) continue;
      const closes = bars.map((b) => b.close);
      const vols = bars.map((b) => b.volume);
      const latest = bars[bars.length - 1];
      if (!latest || latest.close <= 0) continue;
      const ret5 = lookbackReturn(closes, 5);
      const ret10 = lookbackReturn(closes, 10);
      rs5.push(ret5 - spyRet5);
      rs10.push(ret10 - spyRet10);

      const avgVol20 = sma(vols, Math.min(20, vols.length));
      const volExpansion = avgVol20 != null && avgVol20 > 0 ? latest.volume / avgVol20 : 0;
      if (avgVol20 != null && avgVol20 > 0) {
        volExp.push(volExpansion);
      }

      const sma20 = sma(closes, Math.min(20, closes.length));
      const sma50 = sma(closes, Math.min(50, closes.length));
      const sma200 = sma(closes, Math.min(200, closes.length));
      if (sma20 != null) above20.push(latest.close > sma20);
      if (sma50 != null) above50.push(latest.close > sma50);
      if (sma200 != null) above200.push(latest.close > sma200);

      const prior10 = closes.slice(-Math.min(11, closes.length), -1);
      const trigger10 = prior10.length ? Math.max(...prior10) : latest.close;
      const nearTrigger10 = trigger10 > 0 ? latest.close / trigger10 : 0;
      breakoutParticipants.push(nearTrigger10 >= 0.99 && volExpansion >= 1);
      trendPersistent.push(ret5 > 0 && ret10 > 0 && (sma20 == null || latest.close > sma20));
    }

    const symbolsUsed = Math.max(
      rs10.length,
      rs5.length,
      above20.length,
      above50.length,
      above200.length,
      breakoutParticipants.length,
      trendPersistent.length
    );
    const row: SectorMomentumRow = {
      key: group.key,
      name: group.name,
      theme: group.theme,
      symbols_count: group.symbols.length,
      symbols_used: symbolsUsed,
      rs_5d: avg(rs5),
      rs_10d: avg(rs10),
      avg_volume_expansion: avg(volExp),
      pct_above_sma20: above20.length ? (above20.filter(Boolean).length / above20.length) * 100 : 0,
      pct_above_sma50: above50.length ? (above50.filter(Boolean).length / above50.length) * 100 : 0,
      pct_above_sma200: above200.length ? (above200.filter(Boolean).length / above200.length) * 100 : 0,
      breakout_participation: breakoutParticipants.length
        ? (breakoutParticipants.filter(Boolean).length / breakoutParticipants.length) * 100
        : 0,
      trend_persistence: trendPersistent.length
        ? (trendPersistent.filter(Boolean).length / trendPersistent.length) * 100
        : 0,
      rank_score: 0,
      state: "WEAK",
    };

    const rs10Score = clamp((row.rs_10d + 0.08) / 0.18, 0, 1) * 26;
    const rs5Score = clamp((row.rs_5d + 0.05) / 0.12, 0, 1) * 14;
    const p50Score = clamp(row.pct_above_sma50 / 100, 0, 1) * 18;
    const p200Score = clamp(row.pct_above_sma200 / 100, 0, 1) * 16;
    const breakoutScore = clamp(row.breakout_participation / 100, 0, 1) * 12;
    const trendPersistenceScore = clamp(row.trend_persistence / 100, 0, 1) * 8;
    const volScore = clamp((row.avg_volume_expansion - 0.85) / 0.7, 0, 1) * 6;
    row.rank_score = round2(
      rs10Score + rs5Score + p50Score + p200Score + breakoutScore + trendPersistenceScore + volScore
    );
    row.state = stateForRow(row);
    groups.push(row);
  }

  groups.sort((a, b) => (b.rank_score !== a.rank_score ? b.rank_score - a.rank_score : a.name.localeCompare(b.name)));
  return {
    ok: true,
    scan_date: scanDate,
    lctd_source: opts.lctd_source ?? "none",
    groups,
  };
}

export async function computeSectorMomentumCandidates(opts: {
  supabase: any;
  scan_date: string | null;
  lctd_source?: LctdSource | "none";
  universe_slug?: string;
  top_group_count?: number;
  max_candidates?: number;
}) {
  const topGroupCount = Number.isFinite(opts.top_group_count as number) ? Math.max(1, Number(opts.top_group_count)) : 4;
  const maxCandidates = Number.isFinite(opts.max_candidates as number) ? Math.max(1, Number(opts.max_candidates)) : 12;
  const universeSlug = String(opts.universe_slug ?? SECTOR_MOMENTUM_UNIVERSE_SLUG).trim() || SECTOR_MOMENTUM_UNIVERSE_SLUG;

  const ranked = await computeSectorMomentum({
    supabase: opts.supabase,
    scan_date: opts.scan_date,
    lctd_source: opts.lctd_source ?? "none",
  });
  if (!ranked.ok || !ranked.scan_date) {
    return {
      ok: false as const,
      scan_date: ranked.scan_date,
      lctd_source: ranked.lctd_source,
      groups: ranked.groups,
      top_groups: [] as SectorMomentumRow[],
      candidates: [] as SectorMomentumCandidate[],
      error: ranked.error ?? "Sector momentum ranking unavailable",
    };
  }

  const topGroups = ranked.groups.slice(0, topGroupCount);
  const scanDate = ranked.scan_date;
  const from = new Date(`${scanDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 330);
  const fromDate = isoDate(from);

  const topGroupMap = new Map<string, IndustryGroup>(
    topGroups
      .map((g) => {
        const full = INDUSTRY_GROUPS.find((x) => x.key === g.key);
        return full ? [g.key, full] : null;
      })
      .filter((x): x is [string, IndustryGroup] => x !== null)
  );
  const symbols = Array.from(
    new Set(
      Array.from(topGroupMap.values())
        .flatMap((g) => g.symbols)
        .concat(["SPY"])
        .map((s) => s.trim().toUpperCase())
    )
  );

  const supa = opts.supabase as any;
  const { data: universeRow } = await supa
    .from("universes")
    .select("id")
    .eq("slug", universeSlug)
    .maybeSingle();
  let universeSet: Set<string> | null = null;
  if (universeRow?.id) {
    const { data: universeMembers } = await supa
      .from("universe_members")
      .select("symbol")
      .eq("universe_id", universeRow.id)
      .eq("active", true)
      .order("symbol", { ascending: true })
      .limit(5000);
    universeSet = new Set(
      (universeMembers ?? [])
        .map((m: any) => String(m.symbol ?? "").trim().toUpperCase())
        .filter(Boolean)
    );
  }

  const { data, error } = await supa
    .from("price_bars")
    .select("symbol,date,high,low,close,volume,source")
    .in("symbol", symbols)
    .eq("source", "polygon")
    .gte("date", fromDate)
    .lte("date", scanDate)
    .order("date", { ascending: true });
  if (error) {
    return {
      ok: false as const,
      scan_date: scanDate,
      lctd_source: ranked.lctd_source,
      groups: ranked.groups,
      top_groups: topGroups,
      candidates: [] as SectorMomentumCandidate[],
      error: error.message,
    };
  }

  const bySymbol = barsBySymbol(Array.isArray(data) ? data : []);
  const spyBars = bySymbol.get("SPY") ?? [];
  if (spyBars.length < 3) {
    return {
      ok: false as const,
      scan_date: scanDate,
      lctd_source: ranked.lctd_source,
      groups: ranked.groups,
      top_groups: topGroups,
      candidates: [] as SectorMomentumCandidate[],
      error: "Not enough SPY bars for candidate scoring",
    };
  }

  const spyCloses = spyBars.map((b) => b.close);
  const spy20Ret = lookbackReturn(spyCloses, 20);

  const candidatesRaw: SectorMomentumCandidate[] = [];
  for (const group of topGroups) {
    const groupDef = topGroupMap.get(group.key);
    if (!groupDef) continue;
    const groupStats: Array<{ symbol: string; ret20: number }> = [];

    for (const symbol of groupDef.symbols.map((s) => s.trim().toUpperCase())) {
      if (universeSet && !universeSet.has(symbol)) continue;
      const bars = bySymbol.get(symbol) ?? [];
      if (bars.length < 3) continue;
      const latest = bars[bars.length - 1];
      if (latest.close > 0) {
        groupStats.push({ symbol, ret20: lookbackReturn(bars.map((b) => b.close), 20) });
      }
    }
    const groupRet20 = groupStats.length ? avg(groupStats.map((x) => x.ret20)) : 0;

    for (const symbol of groupDef.symbols.map((s) => s.trim().toUpperCase())) {
      if (universeSet && !universeSet.has(symbol)) continue;
      const bars = bySymbol.get(symbol) ?? [];
      if (bars.length < 3) continue;
      const latest = bars[bars.length - 1];
      const closes = bars.map((b) => b.close);
      const vols = bars.map((b) => b.volume);
      const sma20 = sma(closes, Math.min(20, closes.length));
      const sma50 = sma(closes, Math.min(50, closes.length));
      const sma200 = sma(closes, Math.min(200, closes.length));
      if (sma20 == null || sma50 == null || sma200 == null || latest.close <= 0) continue;

      const adv20 = sma(
        bars.slice(-Math.min(20, bars.length)).map((b) => b.close * b.volume),
        Math.min(20, bars.length)
      );
      const vol20 = sma(vols, 20);
      const volExp = vol20 && vol20 > 0 ? latest.volume / vol20 : 0;

      const prior20 = closes.slice(-Math.min(21, closes.length), -1);
      const trigger = prior20.length ? Math.max(...prior20) : latest.close;
      const nearTrigger = trigger > 0 ? latest.close / trigger : 0;
      const extendedPct = trigger > 0 ? (latest.close - trigger) / trigger : 0;

      const window252 = closes.slice(-252);
      const high52 = window252.length ? Math.max(...window252) : Math.max(...closes.slice(-60));
      const near52 = high52 > 0 ? latest.close / high52 : 0;

      const range20Min = prior20.length ? Math.min(...prior20) : latest.close;
      const range20Max = prior20.length ? Math.max(...prior20) : latest.close;
      const range20Pct = range20Min > 0 ? (range20Max - range20Min) / range20Min : 1;

      const ret20 = lookbackReturn(closes, 20);
      const rsVsSpy = ret20 - spy20Ret;
      const rsVsGroup = ret20 - groupRet20;

      const c1 = latest.close > sma20;
      const c2 = latest.close > sma50;
      const c2b = latest.close > sma200;
      const c3 = (adv20 ?? 0) >= 15_000_000;
      const c4 = rsVsSpy > 0;
      const c5 = rsVsGroup > 0;
      const c6 = near52 >= 0.85;
      const c7 = nearTrigger <= 1.05;
      const c8 = range20Pct <= (prior20.length >= 10 ? 0.22 : 0.35);
      const c9 = volExp >= 1.05;
      const c10 = nearTrigger >= 0.98;

      const corePass = c1 && c2 && c2b && c3 && c4 && c5 && c6 && c7 && c8;
      const buyPass = corePass && c9 && c10;

      let signal: CandidateSignal = "AVOID";
      if (buyPass) signal = "BUY";
      else if (corePass || (c1 && c2 && c4 && c6)) signal = "WATCH";

      const score =
        clamp((rsVsSpy + 0.1) / 0.25, 0, 1) * 25 +
        clamp((rsVsGroup + 0.08) / 0.2, 0, 1) * 20 +
        clamp((near52 - 0.75) / 0.25, 0, 1) * 15 +
        clamp((volExp - 0.9) / 0.8, 0, 1) * 10 +
        clamp((nearTrigger - 0.9) / 0.15, 0, 1) * 15 +
        clamp((0.24 - range20Pct) / 0.24, 0, 1) * 15;

      const confidence = signal === "BUY" ? Math.max(70, Math.min(99, score)) : signal === "WATCH" ? Math.max(50, Math.min(84, score)) : Math.min(49, score);
      const entry = round2(trigger > 0 ? trigger : latest.close);
      const stop = round2(entry * 0.92);
      const targets = buildTechnicalTargets({
        bars: bars.map((bar) => ({
          date: bar.date,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })),
        entry,
        stop,
        strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
      });
      const tp1 = targets.tp1;
      const tp2 = targets.tp2;

      const groupStateText =
        group.state === "LEADING"
          ? "group leadership strong"
          : group.state === "IMPROVING"
            ? "group breadth improving"
            : "group breadth weak";
      const setupText =
        buyPass ? "breakout trigger ready" : signal === "WATCH" ? "setup building near pivot" : "setup quality below threshold";
      const evidence = [
        `RS vs SPY ${(rsVsSpy * 100).toFixed(1)}%`,
        `%>SMA50 ${group.pct_above_sma50.toFixed(0)}%`,
        `%>SMA200 ${group.pct_above_sma200.toFixed(0)}%`,
      ];

      const candidate: SectorMomentumCandidate = {
        symbol,
        industry_group: group.name,
        theme: group.theme,
        signal,
        confidence: round2(confidence),
        rank_score: round2(score),
        rank: null,
        entry,
        stop,
        tp1,
        tp2,
        reason_summary: `${signal} • ${groupStateText} • ${setupText} • ${evidence.join(" • ")}`,
        reason_json: {
          strategy: "sector_momentum_v1_phase2",
          group: {
            key: group.key,
            name: group.name,
            theme: group.theme,
            state: group.state,
            group_rank_score: group.rank_score,
            participation: {
              pct_above_sma50: round1(group.pct_above_sma50),
              pct_above_sma200: round1(group.pct_above_sma200),
              breakout_participation: round1(group.breakout_participation),
              trend_persistence: round1(group.trend_persistence),
            },
            relative_strength: {
              rs_5d: round2(group.rs_5d),
              rs_10d: round2(group.rs_10d),
            },
          },
          metrics: {
            close: round2(latest.close),
            sma20: round2(sma20),
            sma50: round2(sma50),
            sma200: round2(sma200),
            avg_dollar_volume_20: round2(adv20 ?? 0),
            volume_expansion: round2(volExp),
            ret20: round2(ret20),
            rs_vs_spy: round2(rsVsSpy),
            rs_vs_group: round2(rsVsGroup),
            near_52w_high_ratio: round2(near52),
            trigger: round2(trigger),
            near_trigger_ratio: round2(nearTrigger),
            extended_pct: round2(extendedPct),
            range20_pct: round2(range20Pct),
          },
          checks: [
            { key: "close_above_sma20", category: "trend", ok: c1, detail: `close ${round2(latest.close)} vs sma20 ${round2(sma20)}` },
            { key: "close_above_sma50", category: "trend", ok: c2, detail: `close ${round2(latest.close)} vs sma50 ${round2(sma50)}` },
            { key: "close_above_sma200", category: "trend", ok: c2b, detail: `close ${round2(latest.close)} vs sma200 ${round2(sma200)}` },
            { key: "adv20_threshold", category: "liquidity", ok: c3, detail: `adv20 ${round2(adv20 ?? 0)}` },
            { key: "rs_vs_spy", category: "rs", ok: c4, detail: `rs_vs_spy ${(rsVsSpy * 100).toFixed(1)}%` },
            { key: "rs_vs_group", category: "rs", ok: c5, detail: `rs_vs_group ${(rsVsGroup * 100).toFixed(1)}%` },
            { key: "near_52w_high", category: "structure", ok: c6, detail: `ratio ${round1(near52 * 100)}%` },
            { key: "not_too_extended", category: "risk", ok: c7, detail: `near_trigger ${round1(nearTrigger * 100)}%` },
            { key: "tightening", category: "structure", ok: c8, detail: `range20 ${(range20Pct * 100).toFixed(1)}%` },
            { key: "supportive_volume", category: "volume", ok: c9, detail: `vol_exp ${round2(volExp)}x` },
            { key: "near_trigger", category: "execution", ok: c10, detail: `near_trigger ${round1(nearTrigger * 100)}%` },
            {
              key: "group_participation",
              category: "group",
              ok: group.pct_above_sma50 >= 50 && group.pct_above_sma200 >= 40,
              detail: `%>sma50 ${group.pct_above_sma50.toFixed(0)}%, %>sma200 ${group.pct_above_sma200.toFixed(0)}%`,
            },
            {
              key: "group_state",
              category: "group",
              ok: group.state !== "WEAK",
              detail: `${group.state} • breakout ${group.breakout_participation.toFixed(0)}% • persistence ${group.trend_persistence.toFixed(0)}%`,
            },
          ],
          summary: {
            group_thesis: `${group.name} ${group.state.toLowerCase()} with RS10 ${(group.rs_10d * 100).toFixed(1)}% and participation ${group.pct_above_sma50.toFixed(0)}%/>50, ${group.pct_above_sma200.toFixed(0)}%/>200`,
            stock_thesis: `${symbol} RS vs SPY ${(rsVsSpy * 100).toFixed(1)}%, trigger ${round2(trigger)}, extension ${(extendedPct * 100).toFixed(1)}%`,
          },
          trade_plan: {
            entry,
            stop,
            tp1,
            tp2,
            max_holding_days: 7,
            stop_style: "pct_8",
            target_model: targets.target_model,
            tp1_reason: targets.tp1_reason,
            tp2_reason: targets.tp2_reason,
            rr_tp1: targets.rr_tp1,
            rr_tp2: targets.rr_tp2,
            resistance_levels: targets.resistance_levels,
          },
          caps: {
            top_group_count: topGroupCount,
            max_candidates: maxCandidates,
          },
        },
      };
      candidatesRaw.push(candidate);
    }
  }

  const rankedCandidates = [...candidatesRaw].sort((a, b) =>
    b.rank_score !== a.rank_score ? b.rank_score - a.rank_score : a.symbol.localeCompare(b.symbol)
  );
  const buy = rankedCandidates.filter((r) => r.signal === "BUY").slice(0, 6);
  const watch = rankedCandidates.filter((r) => r.signal === "WATCH").slice(0, 6);
  const capped = [...buy, ...watch].slice(0, maxCandidates).map((r, idx) => ({ ...r, rank: idx + 1 }));

  return {
    ok: true as const,
    scan_date: scanDate,
    lctd_source: ranked.lctd_source,
    universe_slug: universeSlug,
    groups: ranked.groups,
    top_groups: topGroups,
    candidates: capped,
  };
}
