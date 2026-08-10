import { applyPostStrategyFilters, loadMarketRegimeGate, type Signal as FilterSignal } from "@/lib/post_signal_filters";

type FinalizeArgs = {
  supabase: any;
  date: string;
  universe_slug: string;
  strategy_version: string;
};

type Signal = FilterSignal;

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
  reason_summary: string | null;
  reason_json: Record<string, unknown> | null;
  earnings_date: string | null;
};

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
  const universe_slug = String(opts.universe_slug ?? "").trim();
  if (!universe_slug) {
    return { ok: false, error: "Missing universe_slug for finalizeSignals" };
  }

  const { data: universe, error: universeError } = await supa
    .from("universes")
    .select("id")
    .eq("slug", universe_slug)
    .maybeSingle();
  if (universeError || !universe?.id) {
    return { ok: false, error: universeError?.message ?? `Universe not found: ${universe_slug}` };
  }

  const activeSymbols = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data: members, error: memberError } = await supa
      .from("universe_members")
      .select("symbol")
      .eq("universe_id", universe.id)
      .eq("active", true)
      .range(offset, offset + 999);
    if (memberError) return { ok: false, error: memberError.message };
    for (const member of members ?? []) {
      const symbol = String(member?.symbol ?? "").trim().toUpperCase();
      if (symbol) activeSymbols.add(symbol);
    }
    if ((members?.length ?? 0) < 1000) break;
  }

  let rawRows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supa
      .from("daily_scans")
      .select("*")
      .eq("date", opts.date)
      .eq("universe_slug", universe_slug)
      .eq("strategy_version", opts.strategy_version)
      .range(offset, offset + 999);
    if (error) return { ok: false, error: error.message };
    rawRows.push(...(Array.isArray(data) ? data : []));
    if ((data?.length ?? 0) < 1000) break;
  }

  const inactiveIds = rawRows
    .filter((row) => !activeSymbols.has(String(row?.symbol ?? "").trim().toUpperCase()))
    .map((row) => String(row?.id ?? "").trim())
    .filter(Boolean);
  for (let index = 0; index < inactiveIds.length; index += 500) {
    const { error } = await supa.from("daily_scans").delete().in("id", inactiveIds.slice(index, index + 500));
    if (error) return { ok: false, error: `Inactive scan-row prune failed: ${error.message}` };
  }
  if (inactiveIds.length) {
    const removedIds = new Set(inactiveIds);
    rawRows = rawRows.filter((row) => !removedIds.has(String(row?.id ?? "").trim()));
  }
  if (!rawRows.length) {
    return {
      ok: true,
      date: opts.date,
      universe_slug,
      strategy_version: opts.strategy_version,
      fetched_total: 0,
      updated_rows: 0,
      pruned_inactive_rows: inactiveIds.length,
      before_counts: { buy: 0, watch: 0, avoid: 0 },
      after_counts: { buy: 0, watch: 0, avoid: 0 },
      post_filter_downgrades: 0,
      post_filter_blockers: {
        market_regime_block: 0,
        earnings_proximity_block: 0,
        relative_volume_block: 0,
      },
      total: 0,
      buy: 0,
      watch: 0,
      avoid: 0,
      updated: 0,
    };
  }

  const rawById = new Map(
    rawRows.map((row) => [String(row?.id ?? ""), row] as const)
  );

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
    reason_summary: typeof row.reason_summary === "string" ? row.reason_summary : null,
    reason_json: row.reason_json && typeof row.reason_json === "object" && !Array.isArray(row.reason_json) ? row.reason_json : null,
    earnings_date: typeof row.earnings_date === "string" ? row.earnings_date : null,
  }));

  const before = {
    buy: rows.filter((row) => row.signal === "BUY").length,
    watch: rows.filter((row) => row.signal === "WATCH").length,
    avoid: rows.filter((row) => row.signal === "AVOID").length,
  };

  for (const row of rows) {
    if (row.rank_score === null) row.rank_score = toNumber(row.confidence) ?? 0;
  }

  const marketRegimeGate = await loadMarketRegimeGate({
    supabase: supa,
    scan_date: opts.date,
  });

  let postFilterDowngrades = 0;
  const blockerCounts: Record<string, number> = {
    market_regime_block: 0,
    earnings_proximity_block: 0,
    relative_volume_block: 0,
  };

  for (const row of rows) {
    const originalSignal = row.signal;
    const filtered = applyPostStrategyFilters(
      {
        signal: row.signal,
        strategy_version: row.strategy_version,
        reason_summary: row.reason_summary,
        reason_json: row.reason_json,
        earnings_date: row.earnings_date,
      },
      marketRegimeGate
    );

    row.signal = filtered.signal;
    row.reason_summary = filtered.reason_summary;
    row.reason_json = filtered.reason_json;

    if (originalSignal === "BUY" && filtered.signal === "WATCH") {
      postFilterDowngrades += 1;
    }
    for (const blocker of filtered.filter_blockers) {
      blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
    }
  }

  const sorted = sortByRankScore(rows);
  sorted.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  const nowIso = new Date().toISOString();
  const updatesById = sorted
    .filter((row) => row.id !== null && row.id !== undefined)
    .map((row) => ({
      ...(rawById.get(String(row.id)) ?? {}),
      id: row.id,
      date: row.date,
      universe_slug: row.universe_slug,
      strategy_version: row.strategy_version,
      symbol: row.symbol,
      signal: row.signal,
      rank: row.rank,
      rank_score: row.rank_score,
      reason_summary: row.reason_summary,
      reason_json: row.reason_json,
      updated_at: nowIso,
    }));

  if (updatesById.length !== sorted.length) {
    return {
      ok: false,
      error: "Some rows are missing id; cannot persist by id",
      date: opts.date,
      universe_slug,
      strategy_version: opts.strategy_version,
      fetched_total: sorted.length,
      updated_rows: updatesById.length,
      before_counts: before,
    };
  }

  // Persist one bounded upsert per chunk instead of one HTTP request per row.
  // The immutable scan-row id keeps this update scoped to the current context.
  const chunkSize = 250;
  for (let i = 0; i < updatesById.length; i += chunkSize) {
    const chunk = updatesById.slice(i, i + chunkSize);
    const { error: updateError } = await supa
      .from("daily_scans")
      .upsert(chunk, { onConflict: "id" });
    if (updateError) {
      return {
        ok: false,
        error: String(updateError.message ?? "Update failed"),
        date: opts.date,
        universe_slug,
        strategy_version: opts.strategy_version,
        fetched_total: rows.length,
        before_counts: before,
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
    universe_slug,
    strategy_version: opts.strategy_version,
    fetched_total: sorted.length,
    before,
    after,
    before_counts: before,
    after_counts: after,
    post_filter_downgrades: postFilterDowngrades,
    post_filter_blockers: blockerCounts,
    post_filter_market_regime: marketRegimeGate,
    total: sorted.length,
    buy: after.buy,
    watch: after.watch,
    avoid: after.avoid,
    updated: updatesById.length,
    updated_rows: updatesById.length,
    pruned_inactive_rows: inactiveIds.length,
  };
}
