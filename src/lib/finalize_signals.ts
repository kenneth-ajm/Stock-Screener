type FinalizeArgs = {
  supabase: any;
  date: string;
  universe_slug: string;
  strategy_version: string;
};

type Signal = "BUY" | "WATCH" | "AVOID";

type ScanRow = {
  date: string;
  universe_slug: string;
  strategy_version: string;
  symbol: string;
  signal: Signal;
  confidence: number | null;
  rank_score: number | null;
  rank: number | null;
};

const BUY_CAP = 5;
const WATCH_CAP = 10;

function toNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function sortByRankScore(rows: ScanRow[]) {
  return [...rows].sort((a, b) => {
    const ar = toNumber(a.rank_score) ?? toNumber(a.confidence) ?? 0;
    const br = toNumber(b.rank_score) ?? toNumber(b.confidence) ?? 0;
    if (br !== ar) return br - ar;
    return String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""));
  });
}

export async function finalizeSignals(opts: FinalizeArgs) {
  const supa = opts.supabase as any;
  const { data, error } = await supa
    .from("daily_scans")
    .select("date,universe_slug,strategy_version,symbol,signal,confidence,rank_score,rank")
    .eq("date", opts.date)
    .eq("universe_slug", opts.universe_slug)
    .eq("strategy_version", opts.strategy_version);

  if (error) return { ok: false, error: error.message };
  const rawRows = Array.isArray(data) ? (data as any[]) : [];
  if (!rawRows.length) {
    return {
      ok: true,
      total: 0,
      buy: 0,
      watch: 0,
      avoid: 0,
      updated: 0,
    };
  }

  const rows: ScanRow[] = rawRows.map((row) => ({
    date: String(row.date),
    universe_slug: String(row.universe_slug),
    strategy_version: String(row.strategy_version),
    symbol: String(row.symbol),
    signal:
      row.signal === "BUY" || row.signal === "WATCH" || row.signal === "AVOID"
        ? row.signal
        : "AVOID",
    confidence: toNumber(row.confidence),
    rank_score: toNumber(row.rank_score),
    rank: toNumber(row.rank),
  }));

  for (const row of rows) {
    if (row.rank_score === null) row.rank_score = toNumber(row.confidence) ?? 0;
  }

  const sorted = sortByRankScore(rows);
  sorted.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  const buyRows = sorted.filter((row) => row.signal === "BUY");
  buyRows.forEach((row, idx) => {
    if (idx >= BUY_CAP) row.signal = "WATCH";
  });

  const watchRows = sorted.filter((row) => row.signal === "WATCH");
  watchRows.forEach((row, idx) => {
    if (idx >= WATCH_CAP) row.signal = "AVOID";
  });

  const updates = sorted.map((row) => ({
    date: row.date,
    universe_slug: row.universe_slug,
    strategy_version: row.strategy_version,
    symbol: row.symbol,
    signal: row.signal,
    rank: row.rank,
    rank_score: row.rank_score,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supa
    .from("daily_scans")
    .upsert(updates as any[], { onConflict: "date,universe_slug,symbol,strategy_version" });
  if (upsertError) return { ok: false, error: upsertError.message };

  const buy = sorted.filter((row) => row.signal === "BUY").length;
  const watch = sorted.filter((row) => row.signal === "WATCH").length;
  const avoid = sorted.filter((row) => row.signal === "AVOID").length;

  return {
    ok: true,
    total: sorted.length,
    buy,
    watch,
    avoid,
    updated: updates.length,
  };
}

