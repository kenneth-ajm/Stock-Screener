type FinalizeArgs = {
  supabase: any;
  date: string;
  universe_slug: string;
  strategy_version: string;
};

type Signal = "BUY" | "WATCH" | "AVOID";

type ScanRow = {
  id: string | number | null;
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
    .select("id,date,universe_slug,strategy_version,symbol,signal,confidence,rank_score,rank")
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
    id: row.id ?? null,
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
  const before = {
    buy: rows.filter((row) => row.signal === "BUY").length,
    watch: rows.filter((row) => row.signal === "WATCH").length,
    avoid: rows.filter((row) => row.signal === "AVOID").length,
  };

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

  const nowIso = new Date().toISOString();
  const updatesById = sorted
    .filter((row) => row.id !== null && row.id !== undefined)
    .map((row) => ({
      id: row.id,
      signal: row.signal,
      rank: row.rank,
      rank_score: row.rank_score,
      updated_at: nowIso,
    }));
  const updatesByKey = sorted
    .filter((row) => row.id === null || row.id === undefined)
    .map((row) => ({
      date: row.date,
      universe_slug: row.universe_slug,
      strategy_version: row.strategy_version,
      symbol: row.symbol,
      signal: row.signal,
      rank: row.rank,
      rank_score: row.rank_score,
      updated_at: nowIso,
    }));
  const chunkSize = 500;
  for (let i = 0; i < updatesById.length; i += chunkSize) {
    const chunk = updatesById.slice(i, i + chunkSize);
    const { error: upsertError } = await supa
      .from("daily_scans")
      .upsert(chunk as any[], { onConflict: "id" });
    if (upsertError) {
      return {
        ok: false,
        error: upsertError.message,
        date: opts.date,
        universe_slug: opts.universe_slug,
        strategy_version: opts.strategy_version,
        fetched_total: rows.length,
        before,
      };
    }
  }
  for (let i = 0; i < updatesByKey.length; i += chunkSize) {
    const chunk = updatesByKey.slice(i, i + chunkSize);
    const { error: upsertError } = await supa
      .from("daily_scans")
      .upsert(chunk as any[], { onConflict: "date,universe_slug,symbol,strategy_version" });
    if (upsertError) {
      return {
        ok: false,
        error: upsertError.message,
        date: opts.date,
        universe_slug: opts.universe_slug,
        strategy_version: opts.strategy_version,
        fetched_total: rows.length,
        before,
      };
    }
  }

  const after = {
    buy: sorted.filter((row) => row.signal === "BUY").length,
    watch: sorted.filter((row) => row.signal === "WATCH").length,
    avoid: sorted.filter((row) => row.signal === "AVOID").length,
  };

  return {
    ok: true,
    date: opts.date,
    universe_slug: opts.universe_slug,
    strategy_version: opts.strategy_version,
    fetched_total: sorted.length,
    before,
    after,
    total: sorted.length,
    buy: after.buy,
    watch: after.watch,
    avoid: after.avoid,
    updated: updatesById.length + updatesByKey.length,
    updated_rows: updatesById.length + updatesByKey.length,
  };
}
