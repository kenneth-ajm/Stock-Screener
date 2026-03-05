import { createClient } from "@supabase/supabase-js";
import {
  getFreshnessStatus,
  getLCTD,
  getLatestScanDatesByStrategy,
} from "@/lib/scan_status";
import { getPortfolioSnapshot } from "@/lib/portfolio_snapshot";

type AnyObj = Record<string, unknown>;

export type DiagnosticsResult = {
  ok: boolean;
  lctd: string | null;
  lctd_source: "spy_max_date" | "global_max_date" | "none";
  checks: {
    lctd_vs_scans: { ok: boolean; details: AnyObj };
    caps: { ok: boolean; buy_count: number; watch_count: number; details: AnyObj };
    required_fields: { ok: boolean; missing_count: number; examples: AnyObj[] };
    value_sanity: { ok: boolean; invalid_count: number; examples: AnyObj[] };
    universe_integrity: { ok: boolean; invalid_count: number; examples: AnyObj[] };
    regime_freshness: { ok: boolean; stale: boolean; details: AnyObj };
    portfolio_consistency: { ok: boolean; details: AnyObj };
  };
};

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickExamples<T>(arr: T[], n = 5) {
  return arr.slice(0, n);
}

export async function runDiagnosticsWithClient(supabase: any): Promise<DiagnosticsResult> {
  const supa = supabase as any;

  const lctdStatus = await getLCTD(supa);
  const lctd = lctdStatus.lctd;
  const lctd_source = lctdStatus.source;

  const latestScansByStrategy = await getLatestScanDatesByStrategy(supa, "core_800");
  const latestByStrategyObj =
    latestScansByStrategy.ok && latestScansByStrategy.latest_by_strategy
      ? latestScansByStrategy.latest_by_strategy
      : {};
  const latestByStrategy = new Map<string, string>(Object.entries(latestByStrategyObj));

  const strategyDateMismatches = Array.from(latestByStrategy.entries())
    .filter(([, d]) => (lctd ? d !== lctd : true))
    .map(([strategy_version, latest_scan_date]) => ({ strategy_version, latest_scan_date, lctd }));

  const lctd_vs_scans_ok = !!lctd && strategyDateMismatches.length === 0;

  const { data: latestRowsData } = lctd
    ? await supa
        .from("daily_scans")
        .select(
          "date,universe_slug,strategy_version,symbol,signal,confidence,entry,stop,tp1,tp2,reason_summary,reason_json,rank,rank_score"
        )
        .eq("date", lctd)
        .eq("universe_slug", "core_800")
        .order("strategy_version", { ascending: true })
    : ({ data: [] } as any);
  const latestRows = Array.isArray(latestRowsData) ? latestRowsData : [];

  const capsViolations: AnyObj[] = [];
  let totalBuy = 0;
  let totalWatch = 0;
  const byStrategy = new Map<string, { buy: number; watch: number; total: number }>();
  for (const r of latestRows) {
    const sv = String(r.strategy_version ?? "");
    const cur = byStrategy.get(sv) ?? { buy: 0, watch: 0, total: 0 };
    const sig = String(r.signal ?? "");
    if (sig === "BUY") cur.buy += 1;
    if (sig === "WATCH") cur.watch += 1;
    cur.total += 1;
    byStrategy.set(sv, cur);
    if (sig === "BUY") totalBuy += 1;
    if (sig === "WATCH") totalWatch += 1;
  }
  for (const [strategy_version, v] of byStrategy.entries()) {
    if (v.buy > 5 || v.watch > 10) {
      capsViolations.push({ strategy_version, buy: v.buy, watch: v.watch });
    }
  }

  const missingFieldIssues: AnyObj[] = [];
  for (const r of latestRows) {
    const missing: string[] = [];
    if (!r.signal) missing.push("signal");
    if (r.confidence == null) missing.push("confidence");
    if (r.entry == null) missing.push("entry");
    if (r.stop == null) missing.push("stop");
    if (!r.reason_summary || String(r.reason_summary).trim() === "") missing.push("reason_summary");
    if (!r.reason_json) missing.push("reason_json");
    if (missing.length > 0) {
      missingFieldIssues.push({
        symbol: String(r.symbol ?? ""),
        strategy_version: String(r.strategy_version ?? ""),
        missing,
      });
    }
  }

  const valueSanityIssues: AnyObj[] = [];
  for (const r of latestRows) {
    const entry = toNum(r.entry);
    const stop = toNum(r.stop);
    const tp1 = toNum(r.tp1);
    const tp2 = toNum(r.tp2);
    const confidence = toNum(r.confidence);
    const issues: string[] = [];
    if (entry != null && stop != null && !(stop < entry)) issues.push("stop >= entry");
    if (entry != null && tp1 != null && !(tp1 >= entry)) issues.push("tp1 < entry");
    if (entry != null && tp2 != null && !(tp2 >= entry)) issues.push("tp2 < entry");
    if (confidence != null && (confidence < 0 || confidence > 100))
      issues.push("confidence out of range");
    if (issues.length > 0) {
      valueSanityIssues.push({
        symbol: String(r.symbol ?? ""),
        strategy_version: String(r.strategy_version ?? ""),
        issues,
        values: { entry, stop, tp1, tp2, confidence },
      });
    }
  }

  const { data: universeData } = await supa
    .from("universes")
    .select("id,slug")
    .eq("slug", "core_800")
    .maybeSingle();
  const universe_id = universeData?.id ?? null;
  const { data: memberRows } = universe_id
    ? await supa
        .from("universe_members")
        .select("symbol")
        .eq("universe_id", universe_id)
        .eq("active", true)
    : ({ data: [] } as any);
  const memberSet = new Set(
    (memberRows ?? [])
      .map((r: { symbol?: string | null }) => String(r.symbol ?? "").toUpperCase())
      .filter(Boolean)
  );
  const universeIssues: AnyObj[] = [];
  for (const r of latestRows) {
    const symbol = String(r.symbol ?? "").toUpperCase();
    if (!symbol) continue;
    if (!memberSet.has(symbol)) {
      universeIssues.push({
        symbol,
        strategy_version: String(r.strategy_version ?? ""),
        universe_slug: String(r.universe_slug ?? ""),
      });
    }
  }

  const { data: regimeExact } = lctd
    ? await supa
        .from("market_regime")
        .select("date,state")
        .eq("symbol", "SPY")
        .eq("date", lctd)
        .limit(1)
    : ({ data: [] } as any);
  const regimeRow = regimeExact?.[0] ?? null;
  const regimeFreshness = getFreshnessStatus({
    lctd,
    latestScanDate: lctd,
    regimeDate: regimeRow?.date ? String(regimeRow.date) : null,
  });
  const regime_stale = regimeFreshness.is_stale;

  let portfolioConsistency = {
    ok: true,
    details: {
      checked: false,
      note: "No default portfolio found to validate",
    } as AnyObj,
  };
  const { data: anyDefaultPortfolio } = await supa
    .from("portfolios")
    .select("id,user_id,is_default")
    .eq("is_default", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (anyDefaultPortfolio?.id) {
    const snapshot = await getPortfolioSnapshot(supa, String(anyDefaultPortfolio.id), false);
    if (snapshot) {
      const expectedEstimated = snapshot.account_size - snapshot.deployed_cost_basis;
      const delta = Math.abs(expectedEstimated - snapshot.estimated_cash);
      const manualValid = snapshot.cash_source !== "manual" || snapshot.cash_balance !== null;
      portfolioConsistency = {
        ok: delta <= 0.01 && manualValid,
        details: {
          checked: true,
          portfolio_id: snapshot.portfolio_id,
          account_size: snapshot.account_size,
          deployed_cost_basis: snapshot.deployed_cost_basis,
          estimated_cash: snapshot.estimated_cash,
          expected_estimated_cash: expectedEstimated,
          delta,
          cash_source: snapshot.cash_source,
          cash_balance: snapshot.cash_balance,
          open_count: snapshot.open_count,
          unknown_open_positions_count: snapshot.unknown_open_positions_count,
        },
      };
    }
  }

  const checks: DiagnosticsResult["checks"] = {
    lctd_vs_scans: {
      ok: lctd_vs_scans_ok,
      details: {
        lctd,
        lctd_source,
        latest_by_strategy: latestByStrategyObj,
        mismatches: strategyDateMismatches,
      },
    },
    caps: {
      ok: capsViolations.length === 0,
      buy_count: totalBuy,
      watch_count: totalWatch,
      details: {
        by_strategy: Object.fromEntries(byStrategy.entries()),
        violations: capsViolations,
      },
    },
    required_fields: {
      ok: missingFieldIssues.length === 0,
      missing_count: missingFieldIssues.length,
      examples: pickExamples(missingFieldIssues),
    },
    value_sanity: {
      ok: valueSanityIssues.length === 0,
      invalid_count: valueSanityIssues.length,
      examples: pickExamples(valueSanityIssues),
    },
    universe_integrity: {
      ok: universeIssues.length === 0,
      invalid_count: universeIssues.length,
      examples: pickExamples(universeIssues),
    },
    regime_freshness: {
      ok: !regime_stale,
      stale: regime_stale,
      details: {
        lctd,
        regime_date: regimeRow?.date ?? null,
        regime_state: regimeRow?.state ?? null,
      },
    },
    portfolio_consistency: portfolioConsistency,
  };

  const ok =
    checks.lctd_vs_scans.ok &&
    checks.caps.ok &&
    checks.required_fields.ok &&
    checks.value_sanity.ok &&
    checks.universe_integrity.ok &&
    checks.portfolio_consistency.ok;

  return {
    ok,
    lctd,
    lctd_source,
    checks,
  };
}

export async function runDiagnostics() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as any;
  return runDiagnosticsWithClient(supabase);
}
