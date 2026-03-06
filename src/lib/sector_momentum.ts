import type { LctdSource } from "@/lib/scan_status";

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

type PriceBarLite = {
  symbol: string;
  date: string;
  close: number;
  volume: number;
};

const LOOKBACK_DAYS = 220;

export const INDUSTRY_GROUPS: IndustryGroup[] = [
  { key: "semiconductors", name: "Semiconductors", theme: "AI Hardware", symbols: ["NVDA", "AMD", "AVGO", "MU", "ON", "MRVL"] },
  { key: "cybersecurity", name: "Cybersecurity", theme: "Security Software", symbols: ["CRWD", "PANW", "ZS", "FTNT", "CYBR"] },
  { key: "cloud_software", name: "Cloud Software", theme: "SaaS Leaders", symbols: ["MSFT", "CRM", "NOW", "SNOW", "DDOG", "MDB"] },
  { key: "defense", name: "Defense", theme: "Aerospace & Defense", symbols: ["LMT", "NOC", "RTX", "GD", "LHX"] },
  { key: "biotech", name: "Biotech", theme: "Biotech Innovators", symbols: ["REGN", "VRTX", "ALNY", "BIIB", "MRNA"] },
  { key: "pharma", name: "Pharma", theme: "Large Pharma", symbols: ["LLY", "NVO", "JNJ", "PFE", "MRK"] },
  { key: "oil_gas", name: "Oil & Gas", theme: "Integrated Energy", symbols: ["XOM", "CVX", "COP", "EOG", "OXY"] },
  { key: "oil_services", name: "Oil Services", theme: "Energy Services", symbols: ["SLB", "HAL", "BKR", "NOV", "FTI"] },
  { key: "uranium", name: "Uranium", theme: "Nuclear Fuel", symbols: ["CCJ", "UEC", "UUUU", "NXE"] },
  { key: "solar", name: "Solar", theme: "Solar Buildout", symbols: ["FSLR", "ENPH", "SEDG", "RUN"] },
  { key: "brokers", name: "Brokers", theme: "Capital Markets", symbols: ["SCHW", "IBKR", "HOOD", "MS", "GS"] },
  { key: "insurers", name: "Insurers", theme: "Insurance", symbols: ["PGR", "CB", "ALL", "TRV", "AIG"] },
  { key: "homebuilders", name: "Homebuilders", theme: "Housing Cycle", symbols: ["DHI", "LEN", "NVR", "PHM", "TOL"] },
  { key: "machinery_industrials", name: "Machinery / Industrials", theme: "Industrial Expansion", symbols: ["CAT", "DE", "ETN", "PH", "ROK"] },
  { key: "metals_miners", name: "Metals / Miners", theme: "Materials", symbols: ["FCX", "NEM", "SCCO", "AA", "CLF"] },
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

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function barsBySymbol(rows: any[]): Map<string, PriceBarLite[]> {
  const out = new Map<string, PriceBarLite[]>();
  for (const row of rows) {
    const symbol = String(row?.symbol ?? "").trim().toUpperCase();
    const date = String(row?.date ?? "");
    const close = toNum(row?.close);
    const volume = toNum(row?.volume);
    if (!symbol || !date || close == null || volume == null) continue;
    if (!out.has(symbol)) out.set(symbol, []);
    out.get(symbol)!.push({ symbol, date, close, volume });
  }
  for (const [, bars] of out) {
    bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return out;
}

function stateForRow(row: SectorMomentumRow): SectorMomentumState {
  if (
    row.rs_5d >= 0.02 &&
    row.rs_10d >= 0.03 &&
    row.pct_above_sma20 >= 60 &&
    row.pct_above_sma50 >= 50
  ) {
    return "LEADING";
  }
  if (row.rs_10d >= 0 && row.pct_above_sma20 >= 45) {
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
    .select("symbol,date,close,volume,source")
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
  if (spyBars.length < 15) {
    return {
      ok: false,
      scan_date: scanDate,
      lctd_source: opts.lctd_source ?? "none",
      groups: [],
      error: "Not enough SPY bars for relative-strength baseline",
    };
  }

  const spyLatest = spyBars[spyBars.length - 1]?.close ?? 0;
  const spy5 = spyBars[spyBars.length - 6]?.close ?? 0;
  const spy10 = spyBars[spyBars.length - 11]?.close ?? 0;
  const spyRet5 = spyLatest > 0 && spy5 > 0 ? spyLatest / spy5 - 1 : 0;
  const spyRet10 = spyLatest > 0 && spy10 > 0 ? spyLatest / spy10 - 1 : 0;

  const groups: SectorMomentumRow[] = [];
  for (const group of INDUSTRY_GROUPS) {
    const rs5: number[] = [];
    const rs10: number[] = [];
    const volExp: number[] = [];
    const above20: boolean[] = [];
    const above50: boolean[] = [];

    for (const symbol of group.symbols) {
      const bars = bySymbol.get(symbol.trim().toUpperCase()) ?? [];
      if (bars.length < 55) continue;
      const closes = bars.map((b) => b.close);
      const vols = bars.map((b) => b.volume);
      const latest = bars[bars.length - 1];
      const prev5 = bars[bars.length - 6];
      const prev10 = bars[bars.length - 11];
      if (!latest || !prev5 || !prev10 || prev5.close <= 0 || prev10.close <= 0 || latest.close <= 0) continue;

      const ret5 = latest.close / prev5.close - 1;
      const ret10 = latest.close / prev10.close - 1;
      rs5.push(ret5 - spyRet5);
      rs10.push(ret10 - spyRet10);

      const avgVol20 = sma(vols, 20);
      if (avgVol20 != null && avgVol20 > 0) {
        volExp.push(latest.volume / avgVol20);
      }

      const sma20 = sma(closes, 20);
      const sma50 = sma(closes, 50);
      if (sma20 != null) above20.push(latest.close > sma20);
      if (sma50 != null) above50.push(latest.close > sma50);
    }

    const symbolsUsed = Math.max(rs10.length, rs5.length, above20.length, above50.length);
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
      rank_score: 0,
      state: "WEAK",
    };

    const rs5Score = clamp((row.rs_5d + 0.1) / 0.2, 0, 1) * 30;
    const rs10Score = clamp((row.rs_10d + 0.15) / 0.3, 0, 1) * 35;
    const volScore = clamp((row.avg_volume_expansion - 0.8) / 0.8, 0, 1) * 15;
    const p20Score = clamp(row.pct_above_sma20 / 100, 0, 1) * 10;
    const p50Score = clamp(row.pct_above_sma50 / 100, 0, 1) * 10;
    row.rank_score = round2(rs5Score + rs10Score + volScore + p20Score + p50Score);
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
