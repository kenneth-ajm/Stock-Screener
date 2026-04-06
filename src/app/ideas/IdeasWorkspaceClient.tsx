"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getBuyZone, getEntryStatus } from "@/lib/buy_zone";
import { mapExecutionState } from "@/lib/execution_state";
import { applyEarningsRiskToAction, type EarningsRisk } from "@/lib/earnings_risk";
import { applyBreadthToAction } from "@/lib/market_breadth";
import { defaultUniverseForStrategy } from "@/lib/strategy_universe";

type StrategyVersion = "v1" | "v1_sector_momentum" | "v1_trend_hold" | "quality_dip";
type IdeasFilter = "all" | "buy" | "watch" | "actionable";

type IdeaRow = {
  symbol: string;
  universe_slug?: string | null;
  source_scan_date?: string | null;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  rank?: number | null;
  rank_score?: number | null;
  quality_score?: number | null;
  risk_grade?: "A" | "B" | "C" | "D" | null;
  quality_signal?: "BUY" | "WATCH" | "AVOID" | null;
  quality_summary?: string | null;
  trade_risk_layer?: {
    prep_state?: "READY" | "REVIEW" | "BLOCKED";
    summary?: string;
    risk?: {
      risk_per_share?: number;
      stop_pct?: number;
      rr_tp1?: number;
      rr_tp2?: number;
    };
  } | null;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  reason_summary?: string | null;
  reason_json?: Record<string, unknown> | null;
  industry_group?: string | null;
  theme?: string | null;
  setup_type?: string | null;
  candidate_state?: string | null;
  candidate_state_label?: string | null;
  blockers?: string[] | null;
  watch_items?: string[] | null;
  dossier_summary?: string | null;
  symbol_facts?: {
    close?: number | null;
    sma20?: number | null;
    sma50?: number | null;
    sma200?: number | null;
    above_sma20?: boolean | null;
    above_sma50?: boolean | null;
    above_sma200?: boolean | null;
    atr14?: number | null;
    atr_ratio?: number | null;
    avg_volume20?: number | null;
    avg_dollar_volume20?: number | null;
    relative_volume?: number | null;
    high_30bar?: number | null;
    low_30bar?: number | null;
    drop_from_30bar_high_pct?: number | null;
    distance_from_sma20_pct?: number | null;
    distance_from_sma50_pct?: number | null;
    distance_from_sma200_pct?: number | null;
    trend_state?: string | null;
    extension_state?: string | null;
    liquidity_state?: string | null;
    volatility_state?: string | null;
  } | null;
  change_status?: "NEW" | "UPGRADED" | "UNCHANGED" | "DOWNGRADED" | null;
  change_label?: string | null;
  prior_signal?: "BUY" | "WATCH" | "AVOID" | null;
  prior_quality_score?: number | null;
  prior_date?: string | null;
  action?: "BUY_NOW" | "WAIT" | "SKIP";
  sizing?: {
    shares: number;
    est_cost: number;
    risk_per_share: number;
    risk_budget: number;
    shares_by_risk?: number;
    shares_by_cash?: number;
    shares_by_portfolio_cap?: number | null;
    limiting_factor?: "risk" | "cash" | "portfolio_cap" | "none";
    sizing_mode?: "cash_only";
  };
};

type Payload = {
  ok: boolean;
  meta?: {
    strategy_version?: string | null;
    universe_slug?: string | null;
    requested_universe_slug?: string | null;
    requested_date?: string | null;
    lctd: string | null;
    date_used?: string | null;
    data_source?: string | null;
    fallback_decisions?: string[] | null;
    rows_raw_count?: number | null;
    rows_after_validation_count?: number | null;
    rows_display_count?: number | null;
    rows_signal_counts_raw?: { buy?: number; watch?: number; avoid?: number } | null;
    rows_signal_counts_validated?: { buy?: number; watch?: number; avoid?: number } | null;
    rows_signal_counts_display?: { buy?: number; watch?: number; avoid?: number } | null;
    candidate_state_counts?: {
      actionable_today?: number;
      near_entry?: number;
      quality_watch?: number;
      extended_leader?: number;
      blocked?: number;
      avoid?: number;
    } | null;
    closest_to_actionable?: Array<{
      symbol: string;
      candidate_state?: string | null;
      candidate_state_label?: string | null;
      quality_score?: number | null;
      blockers?: string[] | null;
      dossier_summary?: string | null;
    }> | null;
    improving_rows?: Array<{
      symbol: string;
      change_status?: "NEW" | "UPGRADED" | "UNCHANGED" | "DOWNGRADED" | null;
      change_label?: string | null;
      candidate_state_label?: string | null;
      quality_score?: number | null;
    }> | null;
    blocker_summary?: Array<{ label: string; count: number }> | null;
    change_summary?: {
      new_count?: number;
      upgraded_count?: number;
      unchanged_count?: number;
      downgraded_count?: number;
    } | null;
    rows_count_scope?: string | null;
    rows_query_limit?: number | null;
    selected_universe_has_rows?: boolean | null;
    selected_universe_mode?: string | null;
    allowed_universes?: string[] | null;
    auto_universe_dates?: Array<{ universe_slug: string; date_used: string | null; rows: number }> | null;
    universe_availability?: Record<
      string,
      {
        universe_slug: string;
        latest_date: string | null;
        rows: number;
        buy: number;
        watch: number;
        avoid: number;
        has_scans: boolean;
      }
    > | null;
    response_shape?: {
      raw_rows_is_array?: boolean;
      validated_rows_is_array?: boolean;
      final_rows_is_array?: boolean;
    } | null;
    cache_bust?: string | null;
    read_context_key?: string | null;
    read_context_is_fallback?: boolean | null;
    regime_state: string | null;
    breadth_state?: "STRONG" | "MIXED" | "WEAK" | null;
    breadth_label?: string | null;
    pct_above_sma50?: number | null;
    pct_above_sma200?: number | null;
    market_data_status?: {
      is_stale?: boolean;
      reasons?: string[] | null;
      expected_latest_trading_day?: string | null;
      scheduler_last_run_at?: string | null;
      scheduler_last_scan_date?: string | null;
      scheduler_last_ok?: boolean | null;
    } | null;
  };
  capacity?: {
    cash_available: number;
    cash_source: "manual" | "estimated";
    slots_left: number;
  } | null;
  rows?: IdeaRow[];
  error?: string;
};

type QualityDipSignal = "CONSIDER_BUY" | "WATCH" | "AVOID";

type QualityDipRow = {
  symbol: string;
  name: string;
  group: string;
  current_price: number | null;
  high_30d: number | null;
  drop_pct_from_30d_high: number | null;
  stock_above_sma200: boolean | null;
  market_spy_above_sma200: boolean;
  signal: QualityDipSignal;
  reason_summary: string;
  source_date: string | null;
  bars_count: number;
};

type QualityDipPayload = {
  ok: boolean;
  rows?: QualityDipRow[];
  summary?: { consider_buy: number; watch: number; avoid: number };
  meta?: {
    watchlist_size?: number;
    source_date?: string | null;
    freshness?: {
      expected_date?: string | null;
      latest_symbol_date?: string | null;
      oldest_symbol_date?: string | null;
      stale_symbols_count?: number;
      stale_symbols?: Array<{ symbol: string; source_date: string }>;
      state?: "current" | "mixed" | "stale";
    };
    market?: {
      spy_close?: number | null;
      spy_sma200?: number | null;
      spy_above_sma200?: boolean;
      source_date?: string | null;
    };
    missing_symbols?: string[];
  };
  error?: string;
};
type QualityDipFilter = "all" | "consider_buy" | "watch" | "avoid";
type QualityDipSort = "signal" | "drop" | "price" | "symbol";

type QuoteMap = Record<
  string,
  {
    price: number;
    asOf: string;
    source: "snapshot" | "eod_close";
  } | null
>;
type EarningsRiskMap = Record<string, EarningsRisk>;
const PRICE_MISMATCH_THRESHOLD_PCT = 0.6;

type ManualScanStatus = "idle" | "starting" | "running" | "completed" | "completed_zero" | "failed";

type ManualScanState = {
  status: ManualScanStatus;
  label: string | null;
  detail: string | null;
  requestId: string | null;
  strategyRequested: StrategyVersion | null;
  strategyResolved: string | null;
  universeResolved: string[] | null;
  barsMode: string | null;
  startedAt: string | null;
  endedAt: string | null;
  scanDate: string | null;
  rowsWritten: number;
  rowsNew: number;
  contextRowCount: number | null;
  contextKeys: string[];
  batchesCompleted: number;
  totalBatches: number | null;
  symbolsProcessed: number;
  durationMs: number | null;
  error: string | null;
};

type QualityRefreshState = {
  status: "idle" | "running" | "completed" | "failed";
  detail: string | null;
  durationMs: number | null;
  rowsUpserted: number;
  symbolsSucceeded: number;
  symbolsAttempted: number;
  expectedMarketDate: string | null;
  latestBarDate: string | null;
  error: string | null;
};

type MarketRefreshState = {
  status: "idle" | "running" | "completed" | "failed";
  detail: string | null;
  durationMs: number | null;
  scanDate: string | null;
  error: string | null;
};

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseNullableNumber(v: string) {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmtSignedPct(v: number | null) {
  if (v === null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function formatCompactDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-SG", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

export default function IdeasWorkspaceClient({
  initialStrategy = "v1",
  initialUniverse = "auto",
  initialSymbol = null,
  strategyParamRaw = null,
  showDiagnostics = false,
  buildMarker = "local",
  pageMarker = "ideas-page-marker-missing",
  openTicketOnLoad = false,
  initialManualContext = null,
}: {
  initialStrategy?: StrategyVersion;
  initialUniverse?: string;
  initialSymbol?: string | null;
  strategyParamRaw?: string | null;
  showDiagnostics?: boolean;
  buildMarker?: string;
  pageMarker?: string;
  openTicketOnLoad?: boolean;
  initialManualContext?: {
    symbol: string;
    signal: "BUY" | "WATCH" | "AVOID" | null;
    confidence: number | null;
    entry: number | null;
    stop: number | null;
    tp1: number | null;
    tp2: number | null;
    reason_summary: string | null;
    source_scan_date: string | null;
    universe_slug: string | null;
  } | null;
}) {
  const [strategy, setStrategy] = useState<StrategyVersion>(initialStrategy);
  const [universeMode, setUniverseMode] = useState<string>(initialUniverse);
  const [data, setData] = useState<Payload | null>(null);
  const [qualityDipData, setQualityDipData] = useState<QualityDipPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IdeaRow | null>(null);
  const [fill, setFill] = useState("");
  const [shares, setShares] = useState("");
  const [details, setDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paperSaving, setPaperSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastApiUrl, setLastApiUrl] = useState<string>("");
  const [lastQualityApiUrl, setLastQualityApiUrl] = useState<string>("");
  const [lastLoadOk, setLastLoadOk] = useState<boolean | null>(null);
  const [quoteBySymbol, setQuoteBySymbol] = useState<QuoteMap>({});
  const [earningsBySymbol, setEarningsBySymbol] = useState<EarningsRiskMap>({});
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [entryFee, setEntryFee] = useState("");
  const [exitFee, setExitFee] = useState("");
  const [tpPlan, setTpPlan] = useState<"tp1_only" | "tp1_tp2" | "none">("tp1_tp2");
  const [tp1Pct, setTp1Pct] = useState("");
  const [tp1Price, setTp1Price] = useState("");
  const [tp1SizePct, setTp1SizePct] = useState("50");
  const [tp2Pct, setTp2Pct] = useState("");
  const [tp2Price, setTp2Price] = useState("");
  const [tp2SizePct, setTp2SizePct] = useState("50");
  const [selectedFilter, setSelectedFilter] = useState<IdeasFilter>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityDipFilter>("all");
  const [qualitySort, setQualitySort] = useState<QualityDipSort>("signal");
  const [scanDateHintByStrategy, setScanDateHintByStrategy] = useState<Partial<Record<StrategyVersion, string>>>({});
  const [runScanState, setRunScanState] = useState<ManualScanState>({
    status: "idle",
    label: null,
    detail: null,
    requestId: null,
    strategyRequested: null,
    strategyResolved: null,
    universeResolved: null,
    barsMode: null,
    startedAt: null,
    endedAt: null,
    scanDate: null,
    rowsWritten: 0,
    rowsNew: 0,
    contextRowCount: null,
    contextKeys: [],
    batchesCompleted: 0,
    totalBatches: null,
    symbolsProcessed: 0,
    durationMs: null,
    error: null,
  });
  const [qualityRefreshState, setQualityRefreshState] = useState<QualityRefreshState>({
    status: "idle",
    detail: null,
    durationMs: null,
    rowsUpserted: 0,
    symbolsSucceeded: 0,
    symbolsAttempted: 0,
    expectedMarketDate: null,
    latestBarDate: null,
    error: null,
  });
  const [marketRefreshState, setMarketRefreshState] = useState<MarketRefreshState>({
    status: "idle",
    detail: null,
    durationMs: null,
    scanDate: null,
    error: null,
  });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const tradeTicketRef = useRef<HTMLDivElement | null>(null);
  const entryInputRef = useRef<HTMLInputElement | null>(null);
  const breadth = {
    breadthState: data?.meta?.breadth_state ?? "STRONG",
    breadthLabel: data?.meta?.breadth_label ?? "Breadth strong",
  } as const;
  const runScanBusy = runScanState.status === "starting" || runScanState.status === "running";
  const qualityRefreshBusy = qualityRefreshState.status === "running";
  const marketRefreshBusy = marketRefreshState.status === "running";

  useEffect(() => {
    setStrategy(initialStrategy);
  }, [initialStrategy]);

  useEffect(() => {
    if (strategy === "quality_dip") {
      setSelected(null);
    }
  }, [strategy]);

  useEffect(() => {
    setUniverseMode(initialUniverse);
  }, [initialUniverse]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    if (strategy === "quality_dip") {
      const apiUrl = refreshNonce > 0 ? `/api/quality-dip?_bust=${refreshNonce}` : "/api/quality-dip";
      setLastQualityApiUrl(apiUrl);
      setLastApiUrl(apiUrl);
      setLastLoadOk(null);
      fetch(apiUrl, { cache: "no-store" })
        .then(async (r) => {
          const json = await r.json().catch(() => null);
          if (!mounted) return;
          if (!r.ok || !json) {
            const apiError = (json as any)?.error ?? `HTTP ${r.status}`;
            setLastLoadOk(false);
            setQualityDipData({ ok: false, error: String(apiError) });
            return;
          }
          setLastLoadOk(Boolean(json?.ok));
          setQualityDipData(json as QualityDipPayload);
        })
        .catch((e) => {
          if (!mounted) return;
          setLastLoadOk(false);
          setQualityDipData({ ok: false, error: e instanceof Error ? e.message : "Load failed" });
        })
        .finally(() => mounted && setLoading(false));
      return () => {
        mounted = false;
      };
    }

    const qs = new URLSearchParams({ strategy_version: strategy });
    const strategyDateHint = scanDateHintByStrategy[strategy];
    if (strategyDateHint) qs.set("date", strategyDateHint);
    if (universeMode !== "auto") qs.set("universe_slug", universeMode);
    if (refreshNonce > 0) qs.set("_bust", String(refreshNonce));
    const apiUrl = `/api/screener-data?${qs.toString()}`;
    setLastApiUrl(apiUrl);
    setLastLoadOk(null);
    fetch(apiUrl, {
      cache: "no-store",
    })
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!mounted) return;
        if (!r.ok || !json) {
          const apiError = (json as any)?.error ?? `HTTP ${r.status}`;
          const safeError = String(apiError).toLowerCase().includes("not iterable")
            ? "Data shape mismatch from screener API"
            : apiError;
          setLastLoadOk(false);
          setData({ ok: false, error: safeError });
          setQualityDipData(null);
          return;
        }
        setLastLoadOk(Boolean(json?.ok));
        setData(json);
        setQualityDipData(null);
      })
      .catch((e) => {
        if (!mounted) return;
        setLastLoadOk(false);
        setData({ ok: false, error: e instanceof Error ? e.message : "Load failed" });
        setQualityDipData(null);
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [strategy, universeMode, refreshNonce, scanDateHintByStrategy]);

  async function runQualityDipRefresh() {
    const startedAt = Date.now();
    setQualityRefreshState({
      status: "running",
      detail: "Refreshing Quality Dip watchlist bars from Polygon...",
      durationMs: null,
      rowsUpserted: 0,
      symbolsSucceeded: 0,
      symbolsAttempted: 0,
      expectedMarketDate: null,
      latestBarDate: null,
      error: null,
    });
    try {
      const res = await fetch("/api/quality-dip/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload) {
        throw new Error(String(payload?.error ?? `HTTP ${res.status}`));
      }
      const ok = Boolean(payload?.ok);
      setQualityRefreshState({
        status: ok ? "completed" : "failed",
        detail: ok
          ? `Refreshed ${Number(payload?.symbols_succeeded ?? 0)}/${Number(payload?.symbols_attempted ?? 0)} symbols.`
          : `Refresh completed with gaps: ${String(payload?.status ?? "Unknown issue")}`,
        durationMs: Number(payload?.duration_ms ?? Date.now() - startedAt),
        rowsUpserted: Number(payload?.rows_upserted ?? 0),
        symbolsSucceeded: Number(payload?.symbols_succeeded ?? 0),
        symbolsAttempted: Number(payload?.symbols_attempted ?? 0),
        expectedMarketDate: String(payload?.expected_market_date ?? "") || null,
        latestBarDate: String(payload?.latest_bar_date ?? "") || null,
        error:
          ok || !Array.isArray(payload?.failures) || payload.failures.length === 0
            ? null
            : payload.failures
                .map((f: any) => `${String(f?.symbol ?? "?")}: ${String(f?.error ?? "failed")}`)
                .slice(0, 4)
                .join("; "),
      });
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setQualityRefreshState({
        status: "failed",
        detail: `Refresh failed: ${String(e?.message ?? "Unknown error")}`,
        durationMs: Date.now() - startedAt,
        rowsUpserted: 0,
        symbolsSucceeded: 0,
        symbolsAttempted: 0,
        expectedMarketDate: null,
        latestBarDate: null,
        error: String(e?.message ?? "Unknown error"),
      });
    }
  }

  async function runMarketDataRefresh() {
    const startedAt = Date.now();
    setMarketRefreshState({
      status: "running",
      detail: "Refreshing official daily market data pipeline...",
      durationMs: null,
      scanDate: null,
      error: null,
    });
    try {
      const res = await fetch("/api/admin/refresh-market-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload) {
        throw new Error(String(payload?.error ?? `HTTP ${res.status}`));
      }
      const ok = Boolean(payload?.ok);
      const scanDate = String(payload?.scan_date_used ?? "") || null;
      setMarketRefreshState({
        status: ok ? "completed" : "failed",
        detail: ok
          ? `Market data refresh completed${scanDate ? ` for ${scanDate}` : ""}.`
          : `Market data refresh failed: ${String(payload?.error ?? "Unknown error")}`,
        durationMs: Number(payload?.duration_ms ?? Date.now() - startedAt),
        scanDate,
        error: ok ? null : String(payload?.error ?? "Unknown error"),
      });
      if (ok && scanDate) {
        setScanDateHintByStrategy((prev) => ({
          ...prev,
          v1: scanDate,
          v1_trend_hold: scanDate,
          v1_sector_momentum: scanDate,
        }));
      }
      if (ok) setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setMarketRefreshState({
        status: "failed",
        detail: `Market data refresh failed: ${String(e?.message ?? "Unknown error")}`,
        durationMs: Date.now() - startedAt,
        scanDate: null,
        error: String(e?.message ?? "Unknown error"),
      });
    }
  }

  useEffect(() => {
    if (!(runScanState.status === "starting" || runScanState.status === "running")) return;
    const timer = setTimeout(() => {
      setRunScanState((prev) => ({
        ...prev,
        status: "failed",
        detail: "Failed: timed out while waiting for scan completion.",
        endedAt: new Date().toISOString(),
        durationMs: prev.startedAt ? Date.now() - new Date(prev.startedAt).getTime() : prev.durationMs,
        error: "timed out waiting for scan completion",
      }));
    }, 180000);
    return () => clearTimeout(timer);
  }, [runScanState.status, runScanState.startedAt]);

  useEffect(() => {
    const symbols = (data?.rows ?? []).slice(0, 100).map((r) => r.symbol).filter(Boolean);
    if (symbols.length === 0) {
      setQuoteBySymbol({});
      return;
    }
    let mounted = true;
    fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbols }),
    })
      .then((r) => r.json())
      .then((payload) => {
        if (!mounted) return;
        const map = (payload?.quotes ?? {}) as QuoteMap;
        setQuoteBySymbol(map);
      })
      .catch(() => {
        if (!mounted) return;
        setQuoteBySymbol({});
      });
    return () => {
      mounted = false;
    };
  }, [data?.rows]);

  useEffect(() => {
    const symbols = (data?.rows ?? []).slice(0, 100).map((r) => r.symbol).filter(Boolean);
    if (symbols.length === 0) {
      setEarningsBySymbol({});
      return;
    }
    let mounted = true;
    fetch("/api/earnings-risk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbols }),
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((payload) => {
        if (!mounted) return;
        const map = (payload?.earnings ?? {}) as EarningsRiskMap;
        setEarningsBySymbol(map);
      })
      .catch(() => {
        if (!mounted) return;
        setEarningsBySymbol({});
      });
    return () => {
      mounted = false;
    };
  }, [data?.rows]);

  useEffect(() => {
    if (!selected) return;
    const modelEntry = Number(selected.entry ?? 0);
    const modelTp1 = Number(selected.tp1 ?? 0);
    const modelTp2 = Number(selected.tp2 ?? 0);
    const defaultTp1Pct = modelEntry > 0 ? round1(((modelTp1 / modelEntry) - 1) * 100) : 0;
    const defaultTp2Pct = modelEntry > 0 ? round1(((modelTp2 / modelEntry) - 1) * 100) : 0;

    setFill(String(selected.entry ?? ""));
    setShares(String(selected.sizing?.shares ?? 0));
    setDetails(null);
    setError(null);
    setEntryFee("");
    setExitFee("");
    setTpPlan("tp1_tp2");
    setTp1Pct(defaultTp1Pct > 0 ? String(defaultTp1Pct) : "");
    setTp2Pct(defaultTp2Pct > 0 ? String(defaultTp2Pct) : "");
    setTp1Price(modelTp1 > 0 ? modelTp1.toFixed(2) : "");
    setTp2Price(modelTp2 > 0 ? modelTp2.toFixed(2) : "");
    setTp1SizePct("50");
    setTp2SizePct("50");
    const q = quoteBySymbol[selected.symbol];
    setLivePrice(typeof q?.price === "number" && Number.isFinite(q.price) ? q.price : null);
  }, [selected, quoteBySymbol]);

  useEffect(() => {
    if (!initialSymbol || !data?.rows) return;
    const target = String(initialSymbol).trim().toUpperCase();
    const found = (data.rows ?? []).find((r) => String(r.symbol ?? "").trim().toUpperCase() === target);
    if (found) {
      if (openTicketOnLoad) {
        openTradeTicket(found);
      } else {
        setSelected(found);
      }
      return;
    }
    if (initialManualContext && initialManualContext.symbol === target) {
      const fallbackRow: IdeaRow = {
        symbol: target,
        signal: (initialManualContext.signal ?? "WATCH") as "BUY" | "WATCH" | "AVOID",
        confidence: Number.isFinite(Number(initialManualContext.confidence)) ? Number(initialManualContext.confidence) : 60,
        entry: Number.isFinite(Number(initialManualContext.entry)) ? Number(initialManualContext.entry) : 0,
        stop: Number.isFinite(Number(initialManualContext.stop)) ? Number(initialManualContext.stop) : 0,
        tp1: Number.isFinite(Number(initialManualContext.tp1)) ? Number(initialManualContext.tp1) : 0,
        tp2: Number.isFinite(Number(initialManualContext.tp2)) ? Number(initialManualContext.tp2) : 0,
        reason_summary: initialManualContext.reason_summary ?? "Loaded from manual ticker check context.",
        universe_slug: initialManualContext.universe_slug ?? data?.meta?.universe_slug ?? null,
        source_scan_date: initialManualContext.source_scan_date ?? data?.meta?.date_used ?? null,
        reason_json: null,
        sizing: {
          shares: 0,
          est_cost: 0,
          risk_per_share: 0,
          risk_budget: 0,
          shares_by_risk: 0,
          shares_by_cash: 0,
          shares_by_portfolio_cap: null,
          limiting_factor: "none",
          sizing_mode: "cash_only",
        },
      };
      if (openTicketOnLoad) {
        openTradeTicket(fallbackRow);
      } else {
        setSelected(fallbackRow);
      }
      return;
    }
    setSelected(null);
  }, [initialSymbol, initialManualContext, openTicketOnLoad, data?.rows]);

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const qualityRows = useMemo(() => qualityDipData?.rows ?? [], [qualityDipData]);
  const qualityFreshness = qualityDipData?.meta?.freshness;
  const qualityFreshnessChip =
    qualityFreshness?.state === "current"
      ? `Bars current: ${qualityFreshness.expected_date ?? qualityDipData?.meta?.source_date ?? "—"}`
      : qualityFreshness?.state === "mixed"
        ? `Bars mixed: ${qualityFreshness.expected_date ?? qualityDipData?.meta?.source_date ?? "—"}`
        : `Bars stale: ${qualityFreshness?.oldest_symbol_date ?? qualityDipData?.meta?.source_date ?? "—"}`;
  const staleQualitySymbols = Array.isArray(qualityFreshness?.stale_symbols) ? qualityFreshness.stale_symbols : [];
  const staleQualityPreview =
    staleQualitySymbols.length > 0
      ? staleQualitySymbols
          .slice(0, 6)
          .map((entry) => `${entry.symbol} (${entry.source_date})`)
          .join(", ")
      : "";
  const qualityRowsView = useMemo(() => {
    const filtered = qualityRows.filter((row) => {
      if (qualityFilter === "all") return true;
      if (qualityFilter === "consider_buy") return row.signal === "CONSIDER_BUY";
      if (qualityFilter === "watch") return row.signal === "WATCH";
      return row.signal === "AVOID";
    });
    const signalOrder: Record<QualityDipSignal, number> = {
      CONSIDER_BUY: 0,
      WATCH: 1,
      AVOID: 2,
    };
    const toDrop = (row: QualityDipRow) => Number(row.drop_pct_from_30d_high ?? -999);
    const toPrice = (row: QualityDipRow) => Number(row.current_price ?? -999);
    return [...filtered].sort((a, b) => {
      if (qualitySort === "symbol") {
        return a.symbol.localeCompare(b.symbol);
      }
      if (qualitySort === "drop") {
        const d = toDrop(b) - toDrop(a);
        if (d !== 0) return d;
        return a.symbol.localeCompare(b.symbol);
      }
      if (qualitySort === "price") {
        const d = toPrice(b) - toPrice(a);
        if (d !== 0) return d;
        return a.symbol.localeCompare(b.symbol);
      }
      const sig = signalOrder[a.signal] - signalOrder[b.signal];
      if (sig !== 0) return sig;
      const drop = toDrop(b) - toDrop(a);
      if (drop !== 0) return drop;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [qualityRows, qualityFilter, qualitySort]);
  const qualityGroupedRows = useMemo(() => {
    const order = ["Leaders", "Quality Cyclicals", "Financials", "Industrials & Defense", "ETF Anchors"];
    return order
      .map((group) => ({
        group,
        rows: qualityRowsView.filter((r) => r.group === group),
      }))
      .filter((g) => g.rows.length > 0);
  }, [qualityRowsView]);
  const qualitySummary = useMemo(
    () =>
      qualityDipData?.summary ?? {
        consider_buy: 0,
        watch: 0,
        avoid: 0,
      },
    [qualityDipData]
  );
  const rows = useMemo(() => allRows.slice(0, 10), [allRows]);
  const candidateStateCounts = data?.meta?.candidate_state_counts ?? null;
  const closestToActionable = data?.meta?.closest_to_actionable ?? [];
  const improvingRows = data?.meta?.improving_rows ?? [];
  const blockerSummary = data?.meta?.blocker_summary ?? [];
  const changeSummary = data?.meta?.change_summary ?? null;
  const filteredRows = useMemo(() => {
    if (selectedFilter === "all") return rows;
    if (selectedFilter === "buy") return rows.filter((r) => r.signal === "BUY");
    if (selectedFilter === "watch") return rows.filter((r) => r.signal === "WATCH");
    return rows.filter((r) => r.signal === "BUY" && r.action !== "SKIP");
  }, [rows, selectedFilter]);
  const funnel = useMemo(() => {
    const rowsRaw = Number(data?.meta?.rows_raw_count ?? allRows.length ?? 0);
    const rowsValidated = Number(data?.meta?.rows_after_validation_count ?? allRows.length ?? 0);
    const rowsDisplay = Number(data?.meta?.rows_display_count ?? allRows.length ?? 0);
    const signalCounts = data?.meta?.rows_signal_counts_display ?? data?.meta?.rows_signal_counts_validated ?? data?.meta?.rows_signal_counts_raw ?? {};
    const buyCount = Number(signalCounts.buy ?? 0);
    const watchCount = Number(signalCounts.watch ?? 0);
    const runtime = allRows.reduce(
      (acc, row) => {
        const q = quoteBySymbol[row.symbol];
        const rawLive = typeof q?.price === "number" && Number.isFinite(q.price) ? q.price : null;
        const entry = Number(row.entry ?? 0);
        const mismatch =
          rawLive !== null &&
          entry > 0 &&
          Math.abs((rawLive - entry) / entry) > PRICE_MISMATCH_THRESHOLD_PCT;
        const live = mismatch ? null : rawLive;
        const reason =
          mismatch
            ? "Price mismatch"
            : live !== null
              ? getEntryStatus({
                  price: live,
                  zone_low: getBuyZone({ strategy_version: strategy, model_entry: Number(row.entry) }).zone_low,
                  zone_high: getBuyZone({ strategy_version: strategy, model_entry: Number(row.entry) }).zone_high,
                })
              : "No live price";
        const sym = String(row.symbol ?? "").trim().toUpperCase();
        const earnings = earningsBySymbol[sym] ?? null;
        const exec = applyBreadthToAction(
          applyEarningsRiskToAction(mapExecutionState(reason), earnings),
          breadth
        );
        if (row.signal === "BUY") {
          acc.buyRows += 1;
          if (reason === "Within zone" || reason === "Extended") acc.buyInZone += 1;
          if (exec.action !== "SKIP") acc.buyNotSkipped += 1;
          if (exec.action === "BUY NOW") acc.finalActionable += 1;
        }
        return acc;
      },
      {
        buyRows: 0,
        buyInZone: 0,
        buyNotSkipped: 0,
        finalActionable: 0,
      }
    );
    return {
      rowsRaw,
      rowsValidated,
      rowsDisplay,
      buyCount,
      watchCount,
      buyInZone: runtime.buyInZone,
      buyNotSkipped: runtime.buyNotSkipped,
      finalActionable: runtime.finalActionable,
      buyRowsObserved: runtime.buyRows,
      scope: String(data?.meta?.rows_count_scope ?? "loaded_rows_limit"),
      queryLimit: Number(data?.meta?.rows_query_limit ?? allRows.length ?? 0),
    };
  }, [allRows, breadth, data?.meta, earningsBySymbol, quoteBySymbol, strategy]);
  const universeAvailability = data?.meta?.universe_availability ?? {};
  const coreAvailability = universeAvailability["core_800"] ?? null;
  const midcapAvailability = universeAvailability["midcap_1000"] ?? null;
  const liquidAvailability = universeAvailability["liquid_2000"] ?? null;
  const growthAvailability = universeAvailability["growth_1500"] ?? null;
  const isCoreEnabled = !coreAvailability ? true : Boolean(coreAvailability.has_scans);
  const isMidcapEnabled = !midcapAvailability ? true : Boolean(midcapAvailability.has_scans);
  const isLiquidEnabled = !liquidAvailability ? true : Boolean(liquidAvailability.has_scans);
  const isGrowthEnabled = !growthAvailability ? true : Boolean(growthAvailability.has_scans);
  const emptyStateMessage = useMemo(() => {
    if (loading) return "Loading ideas…";
    if (!data?.ok) return `Failed to load data: ${data?.error ?? "Unknown error"}`;
    const raw = Number(data?.meta?.rows_raw_count ?? 0);
    const validated = Number(data?.meta?.rows_after_validation_count ?? 0);
    const display = Number(data?.meta?.rows_display_count ?? filteredRows.length ?? 0);
    if (display > 0) return null;
    const strategyUsed = data?.meta?.strategy_version ?? strategy;
    const universeUsed = data?.meta?.universe_slug ?? defaultUniverseForStrategy(strategy);
    const dateShown = data?.meta?.date_used ?? data?.meta?.requested_date ?? data?.meta?.lctd ?? "latest";
    const signalCountsRaw = data?.meta?.rows_signal_counts_raw ?? {};
    const signalCountsValidated = data?.meta?.rows_signal_counts_validated ?? {};
    const rawActionable = Number(signalCountsRaw.buy ?? 0) + Number(signalCountsRaw.watch ?? 0);
    const validatedActionable = Number(signalCountsValidated.buy ?? 0) + Number(signalCountsValidated.watch ?? 0);
    if (selectedFilter === "all" && raw === 0 && universeMode !== "auto") {
      return `No scans available yet for strategy=${strategyUsed}, universe=${universeUsed}. Try Auto mode for the latest populated universe.`;
    }
    if (selectedFilter === "all") {
      if (raw === 0) {
        return `No scans available yet for strategy=${strategyUsed}, universe=${universeUsed}, date=${dateShown}`;
      }
      if (filteredRows.length === 0) {
        return `No rows available for strategy=${strategyUsed}, universe=${universeUsed}, date=${dateShown}`;
      }
      return null;
    }
    if (raw === 0) {
      return `No scans available yet for strategy=${strategyUsed}, universe=${universeUsed}, date=${dateShown}`;
    }
    if (validated === 0) {
      return `Rows were filtered out after validation for strategy=${strategyUsed}, universe=${universeUsed}, date=${dateShown}.`;
    }
    if (rawActionable === 0 || validatedActionable === 0) {
      return `Rows exist but none are BUY/WATCH for strategy=${strategyUsed}, universe=${universeUsed}, date=${dateShown}.`;
    }
    if (validatedActionable > 0 && display === 0) {
      return `BUY/WATCH rows exist but display filtering removed them for strategy=${strategyUsed}, universe=${universeUsed}, date=${dateShown}.`;
    }
    return `No BUY/WATCH candidates after display caps for strategy=${strategyUsed}, universe=${universeUsed}, date=${dateShown}.`;
  }, [loading, data, filteredRows.length, strategy, selectedFilter, universeMode]);
  const readContextKey = String(data?.meta?.read_context_key ?? "").trim() || null;
  const readContextMatchesLatestManualScan =
    Boolean(readContextKey) &&
    (runScanState.contextKeys ?? []).includes(String(readContextKey));
  const showingExistingRowsAfterZeroScan =
    runScanState.status === "completed_zero" &&
    readContextMatchesLatestManualScan &&
    Number(data?.meta?.rows_display_count ?? 0) > 0;
  const marketDataStatus = data?.meta?.market_data_status ?? null;
  const marketDataIsStale = strategy !== "quality_dip" && Boolean(marketDataStatus?.is_stale);
  const marketDataReasonSummary =
    Array.isArray(marketDataStatus?.reasons) && marketDataStatus.reasons.length > 0
      ? marketDataStatus.reasons.join(" • ")
      : "Underlying price bars are stale.";
  const marketDataLastRunLabel = formatCompactDateTime(marketDataStatus?.scheduler_last_run_at ?? null);
  const marketDataRefreshDetail = marketRefreshState.detail ?? "—";
  const fillNum = Number(fill);
  const stopNum = Number(selected?.stop ?? 0);
  const riskPerShare = fillNum > 0 && stopNum > 0 ? fillNum - stopNum : 0;
  const riskBudget = Number(selected?.sizing?.risk_budget ?? 0);
  const cashAvailableForSizing = Number(data?.capacity?.cash_available ?? 0);
  const sharesByRisk =
    riskPerShare > 0 && Number.isFinite(riskBudget) ? Math.max(0, Math.floor(riskBudget / riskPerShare)) : 0;
  const sharesByCash =
    fillNum > 0 && Number.isFinite(cashAvailableForSizing) ? Math.max(0, Math.floor(cashAvailableForSizing / fillNum)) : 0;
  const sharesByPortfolioCap =
    typeof selected?.sizing?.shares_by_portfolio_cap === "number" && Number.isFinite(selected.sizing.shares_by_portfolio_cap)
      ? Math.max(0, Math.floor(selected.sizing.shares_by_portfolio_cap))
      : null;
  const sizeCandidates = [sharesByRisk, sharesByCash, ...(sharesByPortfolioCap != null ? [sharesByPortfolioCap] : [])];
  const suggestedShares = sizeCandidates.length > 0 ? Math.max(0, Math.min(...sizeCandidates)) : 0;
  const limitingFactor =
    sharesByPortfolioCap != null && suggestedShares === sharesByPortfolioCap
      ? "Limited by portfolio cap"
      : suggestedShares === sharesByCash
      ? "Limited by available cash"
      : suggestedShares === sharesByRisk
      ? "Limited by risk budget"
      : "Sizing unavailable";
  const sharesNum = Number(shares);
  const positionCost = Number.isFinite(sharesNum) && Number.isFinite(fillNum) ? sharesNum * fillNum : 0;
  const riskUsed = Number.isFinite(sharesNum) && Number.isFinite(riskPerShare) ? sharesNum * riskPerShare : 0;
  const zone = selected
    ? getBuyZone({ strategy_version: strategy, model_entry: Number(selected.entry) })
    : { zone_low: 0, zone_high: 0 };
  const statusPrice = livePrice ?? (Number.isFinite(fillNum) ? fillNum : null);
  const entryStatus = getEntryStatus({
    price: statusPrice,
    zone_low: zone.zone_low,
    zone_high: zone.zone_high,
  });

  function openTradeTicket(row: IdeaRow) {
    setSelected(row);
    requestAnimationFrame(() => {
      tradeTicketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      requestAnimationFrame(() => {
        entryInputRef.current?.focus();
        entryInputRef.current?.select();
      });
    });
  }
  const modelTp1Pct =
    selected && selected.entry > 0 ? (((selected.tp1 ?? selected.entry) / selected.entry - 1) * 100) : 0;
  const modelTp2Pct =
    selected && selected.entry > 0 ? (((selected.tp2 ?? selected.entry) / selected.entry - 1) * 100) : 0;
  const feesTotal =
    (Number.isFinite(Number(entryFee)) ? Number(entryFee) : 0) +
    (Number.isFinite(Number(exitFee)) ? Number(exitFee) : 0);
  const totalCostWithFees = positionCost + feesTotal;

  async function openDetails() {
    if (!selected || detailsLoading || details) return;
    if ((strategy === "v1_sector_momentum" || strategy === "quality_dip") && selected.reason_json) {
      setDetails({ ok: true, row: selected, source: "sector_momentum_inline" });
      return;
    }
    setDetailsLoading(true);
    try {
      const query = new URLSearchParams({
        symbol: selected.symbol,
        strategy_version: strategy,
        universe_slug: universeMode === "auto" ? data?.meta?.universe_slug ?? defaultUniverseForStrategy(strategy) : universeMode,
        date: data?.meta?.lctd ?? "",
      });
      const res = await fetch(`/api/scan-row-detail?${query.toString()}`, { cache: "no-store" });
      const payload = await res.json().catch(() => null);
      setDetails(payload);
    } finally {
      setDetailsLoading(false);
    }
  }

  async function addPosition() {
    if (!selected) return;
    const entry = Number(fill);
    const stop = Number(selected.stop);
    const qty = Math.floor(Number(shares));
    const tpAnchorEntry = Number(selected.entry);
    if (!(entry > 0) || !(stop > 0) || !(qty > 0) || !(entry > stop)) {
      setError("Enter valid entry, stop, and shares.");
      return;
    }
    if (!Number.isFinite(tpAnchorEntry) || tpAnchorEntry <= 0) {
      setError("Model entry is invalid for TP planning.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const entryFeeValue = parseNullableNumber(entryFee);
      const exitFeeValue = parseNullableNumber(exitFee);
      if (entryFeeValue !== null && entryFeeValue < 0) {
        setError("Entry fee must be blank or >= 0.");
        return;
      }
      if (exitFeeValue !== null && exitFeeValue < 0) {
        setError("Exit fee must be blank or >= 0.");
        return;
      }

      let finalTp1Pct: number | null = null;
      let finalTp1Price: number | null = null;
      let finalTp1SizePct: number | null = null;
      let finalTp2Pct: number | null = null;
      let finalTp2Price: number | null = null;
      let finalTp2SizePct: number | null = null;

      if (tpPlan !== "none") {
        const tp1PctInput = parseNullableNumber(tp1Pct);
        const tp1PriceInput = parseNullableNumber(tp1Price);
        if (tp1PriceInput !== null) {
          const derivedPct = round1(((tp1PriceInput / tpAnchorEntry) - 1) * 100);
          if (derivedPct <= 0 || tp1PriceInput <= tpAnchorEntry) {
            setError("TP1 must be above entry.");
            return;
          }
          finalTp1Pct = derivedPct;
          finalTp1Price = round2(tp1PriceInput);
        } else if (tp1PctInput !== null && tp1PctInput > 0) {
          finalTp1Pct = round1(tp1PctInput);
          finalTp1Price = round2(tpAnchorEntry * (1 + finalTp1Pct / 100));
        } else {
          setError("TP1 % or TP1 price must be provided.");
          return;
        }

        if (tpPlan === "tp1_only") {
          const size = parseNullableNumber(tp1SizePct);
          finalTp1SizePct = size == null ? 100 : Math.round(size);
          finalTp2SizePct = 0;
        }

        if (tpPlan === "tp1_tp2") {
          const tp2PctInput = parseNullableNumber(tp2Pct);
          const tp2PriceInput = parseNullableNumber(tp2Price);
          if (tp2PriceInput !== null) {
            const derivedPct = round1(((tp2PriceInput / tpAnchorEntry) - 1) * 100);
            if (derivedPct <= 0 || tp2PriceInput <= tpAnchorEntry) {
              setError("TP2 must be above entry.");
              return;
            }
            finalTp2Pct = derivedPct;
            finalTp2Price = round2(tp2PriceInput);
          } else if (tp2PctInput !== null && tp2PctInput > 0) {
            finalTp2Pct = round1(tp2PctInput);
            finalTp2Price = round2(tpAnchorEntry * (1 + finalTp2Pct / 100));
          } else {
            setError("TP2 % or TP2 price must be provided.");
            return;
          }

          const size1 = parseNullableNumber(tp1SizePct);
          const size2 = parseNullableNumber(tp2SizePct);
          if (
            size1 === null ||
            size2 === null ||
            size1 < 0 ||
            size1 > 100 ||
            size2 < 0 ||
            size2 > 100 ||
            Math.round(size1) + Math.round(size2) !== 100
          ) {
            setError("TP1 size % + TP2 size % must sum to 100.");
            return;
          }
          finalTp1SizePct = Math.round(size1);
          finalTp2SizePct = Math.round(size2);
        }
      }

      const tpPayload = {
        tp_plan: tpPlan,
        tp1_pct: finalTp1Pct,
        tp2_pct: finalTp2Pct,
        tp1_price: finalTp1Price,
        tp2_price: finalTp2Price,
        tp1_size_pct: finalTp1SizePct,
        tp2_size_pct: finalTp2SizePct,
      };

      const res = await fetch("/api/positions/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: selected.symbol,
          entry_price: entry,
          stop,
          shares: qty,
          strategy_version: strategy,
          max_hold_days: strategy === "v1_trend_hold" ? 45 : 7,
          tp_model: strategy === "v1_trend_hold" ? "percent_10_20" : "percent_5_10",
          entry_fee: entryFeeValue,
          exit_fee: exitFeeValue,
          ...tpPayload,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.error ?? "Add position failed");
      setSelected(null);
      setToast(`Position added: ${selected.symbol}`);
      setTimeout(() => setToast(null), 1800);
    } catch (e: any) {
      setError(e?.message ?? "Add position failed");
    } finally {
      setSaving(false);
    }
  }

  async function openPaperPosition() {
    if (!selected) return;
    const entry = Number(fill);
    const stop = Number(selected.stop);
    const qty = Math.floor(Number(shares));
    if (!(entry > 0) || !(stop > 0) || !(qty > 0) || !(entry > stop)) {
      setError("Enter valid entry, stop, and shares.");
      return;
    }

    let tp1Out: number | null = null;
    let tp2Out: number | null = null;
    if (tpPlan !== "none") {
      const parsedTp1 = parseNullableNumber(tp1Price);
      const parsedTp2 = parseNullableNumber(tp2Price);
      tp1Out = parsedTp1 != null && parsedTp1 > 0 ? round2(parsedTp1) : Number(selected.tp1) > 0 ? round2(Number(selected.tp1)) : null;
      if (tpPlan === "tp1_tp2") {
        tp2Out =
          parsedTp2 != null && parsedTp2 > 0 ? round2(parsedTp2) : Number(selected.tp2) > 0 ? round2(Number(selected.tp2)) : null;
      }
    }

    setPaperSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/paper-positions/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: selected.symbol,
          strategy_version: strategy,
          universe_slug:
            selected.universe_slug ?? data?.meta?.universe_slug ?? null,
          source_scan_date: selected.source_scan_date ?? data?.meta?.date_used ?? null,
          entry_price: entry,
          stop_price: stop,
          tp1: tp1Out,
          tp2: tp2Out,
          shares: qty,
          reason_summary: selected.reason_summary ?? null,
          status: "OPEN",
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.error ?? "Open paper position failed");
      setToast(`Paper position opened: ${selected.symbol}`);
      setTimeout(() => setToast(null), 1800);
    } catch (e: any) {
      const msg = e?.message ?? "Open paper position failed";
      setError(msg);
      setToast(`Paper open failed: ${msg}`);
      setTimeout(() => setToast(null), 2600);
    } finally {
      setPaperSaving(false);
    }
  }

  async function runStrategyScan(strategyToRun: Exclude<StrategyVersion, "quality_dip">, label: string) {
    const requestId = `scan_ui_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startedAtMs = Date.now();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    setRunScanState({
      status: "starting",
      label,
      detail: "Starting manual scan...",
      requestId,
      strategyRequested: strategyToRun,
      strategyResolved: null,
      universeResolved: null,
      barsMode: null,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: null,
      scanDate: null,
      rowsWritten: 0,
      rowsNew: 0,
      contextRowCount: null,
      contextKeys: [],
      batchesCompleted: 0,
      totalBatches: null,
      symbolsProcessed: 0,
      durationMs: null,
      error: null,
    });
    try {
      const strategyUniverses: Record<Exclude<StrategyVersion, "quality_dip">, string[]> = {
        v1: ["liquid_2000", "midcap_1000"],
        v1_trend_hold: ["core_800", "liquid_2000"],
        v1_sector_momentum: ["growth_1500", "midcap_1000"],
      };
      const universes = strategyUniverses[strategyToRun] ?? [];

      const postWithTimeout = async (body: Record<string, unknown>, timeoutMs = 60000) => {
        const controller = new AbortController();
        let timer: any = null;
        try {
          const fetchPromise = fetch("/api/admin/run-scan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error(`request timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          });
          const res = await Promise.race([fetchPromise, timeoutPromise]);
          const payload = await res.json().catch(() => null);
          return { res, payload };
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      const readStatus = async () => {
        const res = await fetch(`/api/admin/run-scan?mode=status&request_id=${encodeURIComponent(requestId)}`, {
          cache: "no-store",
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.ok) return null;
        return payload?.scan_status ?? null;
      };
      const tryBatch = async (strategy_version: StrategyVersion, universe_slug: string, offset: number) => {
        const batchCandidates = [25, 15, 10];
        let lastErr: Error | null = null;
        for (const size of batchCandidates) {
          const { res, payload } = await postWithTimeout(
            {
              mode: "batch",
              strategy_version,
              universe_slug,
              request_id: requestId,
              offset,
              batch_size: size,
            },
            28000
          );
          if (res.ok && payload?.ok) return { res, payload };
          const msg = String(payload?.error ?? payload?.status ?? `HTTP ${res.status}`);
          lastErr = new Error(msg);
          const isTimeout = msg.toLowerCase().includes("timed out");
          if (!isTimeout) break;
          setRunScanState((prev) => ({
            ...prev,
            status: "running",
            detail: `Batch timed out at size ${size}; retrying smaller batch...`,
          }));
        }
        throw lastErr ?? new Error("scan batch failed");
      };
      pollTimer = setInterval(async () => {
        try {
          const status = await readStatus();
          if (!status) return;
          setRunScanState((prev) => ({
            ...prev,
            status: status?.status === "failed" ? "failed" : prev.status,
            detail: String(status?.detail ?? prev.detail ?? ""),
            rowsWritten: Number(status?.rows_written ?? prev.rowsWritten ?? 0),
            rowsNew: Number(status?.rows_new ?? prev.rowsNew ?? 0),
            batchesCompleted: Number(status?.batch_index ?? prev.batchesCompleted ?? 0),
            totalBatches:
              Number.isFinite(Number(status?.total_batches))
                ? Number(status?.total_batches)
                : prev.totalBatches,
            symbolsProcessed: Number(status?.symbols_processed ?? prev.symbolsProcessed ?? 0),
          }));
        } catch {
          // non-fatal
        }
      }, 1500);

      let totalRowsWritten = 0;
      let totalRowsNew = 0;
      let batchesCompleted = 0;
      let totalBatchesSeen: number | null = null;
      let symbolsProcessed = 0;
      let finalScanDate = "";
      let lastStrategyResolved: string | null = null;
      let lastBarsMode: string | null = "cached_db_only";
      let lastContextRowCount: number | null = null;
      const contextKeySet = new Set<string>();
      for (const universe of universes) {
        const resolvedUniverses = universes.slice(0, universes.indexOf(universe) + 1);
        setRunScanState((prev) => ({
          ...prev,
          status: "running",
          detail: `Running ${label}: ${universe}`,
          universeResolved: resolvedUniverses,
        }));
        let offset = 0;
        let keepGoing = true;
        while (keepGoing) {
          const { res, payload } = await tryBatch(strategyToRun, universe, offset);
          if (!res.ok || !payload?.ok) {
            const step = payload?.failed_step;
            const failedLabel = step
              ? `${String(step.strategy_version)} @ ${String(step.universe_slug)} batch ${String(step.batch_index ?? "?")}`
              : `${strategyToRun} @ ${universe}`;
            throw new Error(
              `${failedLabel}: ${String(payload?.error ?? payload?.status ?? `HTTP ${res.status}`)}`
            );
          }

          totalRowsWritten += Number(payload?.rows_written ?? 0);
          totalRowsNew += Number(payload?.rows_new ?? 0);
          finalScanDate = String(payload?.scan_date_used ?? finalScanDate);
          lastStrategyResolved = String(payload?.strategy_version_resolved ?? payload?.strategy ?? strategyToRun);
          lastBarsMode = String(payload?.bars_mode ?? lastBarsMode ?? "cached_db_only");
          if (Number.isFinite(Number(payload?.context_row_count))) {
            lastContextRowCount = Number(payload?.context_row_count);
          }
          if (payload?.scan_context_key) contextKeySet.add(String(payload.scan_context_key));
          keepGoing = Boolean(payload?.has_more);
          offset = Number(payload?.next_offset ?? 0);
          const batchIndex = Number(payload?.batch_index ?? 0);
          const totalBatches = Number(payload?.total_batches ?? 0);
          if (batchIndex > 0) batchesCompleted = batchIndex;
          if (totalBatches > 0) totalBatchesSeen = totalBatches;
          symbolsProcessed = Math.max(symbolsProcessed, Number(payload?.symbols_processed_total ?? payload?.symbols_processed_batch ?? 0));
          setRunScanState((prev) => ({
            ...prev,
            status: "running",
            detail:
              batchIndex > 0 && totalBatches > 0
                ? `Running ${label}: ${universe} batch ${batchIndex}/${totalBatches}`
                : `Running ${label}: ${universe} batch offset ${offset}`,
            rowsWritten: totalRowsWritten,
            rowsNew: totalRowsNew,
            contextRowCount: lastContextRowCount,
            contextKeys: Array.from(contextKeySet),
            batchesCompleted,
            totalBatches: totalBatchesSeen,
            symbolsProcessed,
            scanDate: finalScanDate || prev.scanDate,
          }));
        }

        setRunScanState((prev) => ({
          ...prev,
          status: "running",
          detail: `Finalizing ${label}: ${universe}`,
        }));
        const finalize = await postWithTimeout({
          mode: "finalize",
          strategy_version: strategyToRun,
          universe_slug: universe,
          request_id: requestId,
        });
        if (!finalize.res.ok || !finalize.payload?.ok) {
          throw new Error(
            `${strategyToRun} @ ${universe} finalize: ${String(
              finalize.payload?.error ?? finalize.payload?.status ?? `HTTP ${finalize.res.status}`
            )}`
          );
        }
        totalRowsWritten += Number(finalize.payload?.rows_written ?? 0);
        totalRowsNew += Number(finalize.payload?.rows_new ?? 0);
        finalScanDate = String(finalize.payload?.scan_date_used ?? finalScanDate);
        lastStrategyResolved = String(finalize.payload?.strategy_version_resolved ?? lastStrategyResolved ?? strategyToRun);
        lastBarsMode = String(finalize.payload?.bars_mode ?? lastBarsMode ?? "cached_db_only");
        if (Number.isFinite(Number(finalize.payload?.context_row_count))) {
          lastContextRowCount = Number(finalize.payload?.context_row_count);
        }
        if (finalize.payload?.scan_context_key) contextKeySet.add(String(finalize.payload.scan_context_key));
      }

      if (finalScanDate) {
        setScanDateHintByStrategy((prev) => ({ ...prev, [strategyToRun]: finalScanDate }));
      }
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - startedAtMs;
      const rowsOut = Number.isFinite(totalRowsWritten) ? totalRowsWritten : 0;
      const rowsNewOut = Number.isFinite(totalRowsNew) ? totalRowsNew : 0;
      const contextKeysOut = Array.from(contextKeySet);
      setRunScanState({
        status: rowsOut > 0 || rowsNewOut > 0 ? "completed" : "completed_zero",
        label,
        detail:
          rowsOut > 0 || rowsNewOut > 0
            ? `Completed. ${rowsOut} rows processed (${rowsNewOut} net new)${finalScanDate ? ` on ${finalScanDate}` : ""}.`
            : `Completed with 0 processed rows${finalScanDate ? ` on ${finalScanDate}` : ""}.`,
        requestId,
        strategyRequested: strategyToRun,
        strategyResolved: lastStrategyResolved ?? strategyToRun,
        universeResolved: universes,
        barsMode: lastBarsMode ?? "cached_db_only",
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt,
        scanDate: finalScanDate || null,
        rowsWritten: rowsOut,
        rowsNew: rowsNewOut,
        contextRowCount: lastContextRowCount,
        contextKeys: contextKeysOut,
        batchesCompleted,
        totalBatches: totalBatchesSeen,
        symbolsProcessed,
        durationMs,
        error: null,
      });
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "request timed out" : String(e?.message ?? "Unknown error");
      setRunScanState({
        status: "failed",
        label,
        detail: `Failed: ${msg}`,
        requestId,
        strategyRequested: strategyToRun,
        strategyResolved: strategyToRun,
        universeResolved: strategyToRun === "v1" ? ["liquid_2000", "midcap_1000"] : strategyToRun === "v1_trend_hold" ? ["core_800", "liquid_2000"] : ["growth_1500", "midcap_1000"],
        barsMode: "cached_db_only",
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: new Date().toISOString(),
        scanDate: null,
        rowsWritten: 0,
        rowsNew: 0,
        contextRowCount: null,
        contextKeys: [],
        batchesCompleted: 0,
        totalBatches: null,
        symbolsProcessed: 0,
        durationMs: Date.now() - startedAtMs,
        error: msg,
      });
    } finally {
      if (pollTimer) clearInterval(pollTimer);
    }
  }

  function signalPill(signal: "BUY" | "WATCH" | "AVOID") {
    if (signal === "BUY") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (signal === "WATCH") return "border-amber-200 bg-amber-50 text-amber-700";
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  function qualitySignalPill(signal: QualityDipSignal) {
    if (signal === "CONSIDER_BUY") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (signal === "WATCH") return "border-amber-200 bg-amber-50 text-amber-700";
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  function toQualityDipTradeRow(row: QualityDipRow): IdeaRow | null {
    const entry = Number(row.current_price ?? 0);
    if (!Number.isFinite(entry) || entry <= 0) return null;
    const stop = round2(entry * 0.94);
    const tp1 = round2(entry * 1.06);
    const tp2 = round2(entry * 1.12);
    const mappedSignal: "BUY" | "WATCH" | "AVOID" =
      row.signal === "CONSIDER_BUY" ? "BUY" : row.signal === "WATCH" ? "WATCH" : "AVOID";
    const riskPerShare = Math.max(0, entry - stop);
    const cashAvailable = Number(data?.capacity?.cash_available ?? 0);
    const sharesByCash = entry > 0 ? Math.floor(cashAvailable / entry) : 0;
    const shares = Math.max(0, sharesByCash);
    return {
      symbol: row.symbol,
      signal: mappedSignal,
      confidence: mappedSignal === "BUY" ? 70 : mappedSignal === "WATCH" ? 60 : 40,
      rank: null,
      rank_score: null,
      entry,
      stop,
      tp1,
      tp2,
      reason_summary: `Quality Dip ${row.signal.replace("_", " ")} • ${row.reason_summary}`,
      reason_json: {
        strategy: "quality_dip_v1",
        quality_dip: {
          drop_pct_from_30d_high: row.drop_pct_from_30d_high,
          stock_above_sma200: row.stock_above_sma200,
          market_spy_above_sma200: row.market_spy_above_sma200,
        },
      },
      universe_slug: "quality_dip_watchlist",
      source_scan_date: row.source_date,
      sizing: {
        shares,
        est_cost: round2(shares * entry),
        risk_per_share: round2(riskPerShare),
        risk_budget: round2(riskPerShare * shares),
        shares_by_risk: shares,
        shares_by_cash: sharesByCash,
        shares_by_portfolio_cap: null,
        limiting_factor: "cash",
        sizing_mode: "cash_only",
      },
    };
  }

  function actionPill(action: "BUY NOW" | "WAIT" | "SKIP") {
    if (action === "BUY NOW") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (action === "WAIT") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function candidateStatePill(state: string | null | undefined) {
  switch (state) {
    case "ACTIONABLE_TODAY":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "NEAR_ENTRY":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "QUALITY_WATCH":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "EXTENDED_LEADER":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "BLOCKED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function changePill(status: string | null | undefined) {
  switch (status) {
    case "NEW":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "UPGRADED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "DOWNGRADED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

  return (
    <div className="space-y-5">
      {toast ? (
        <div className="fixed bottom-5 right-5 z-[60] rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl">
          {toast}
        </div>
      ) : null}
      <div className="surface-panel flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-2 rounded-xl border border-[#e3d5bf] bg-[#fcf8f1] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <button
            onClick={() => setStrategy("v1")}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
              strategy === "v1"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f3eadc]"
            }`}
          >
            Momentum Swing
          </button>
          <button
            onClick={() => setStrategy("v1_sector_momentum")}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
              strategy === "v1_sector_momentum"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f3eadc]"
            }`}
          >
            Sector Momentum
          </button>
          <button
            onClick={() => setStrategy("v1_trend_hold")}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
              strategy === "v1_trend_hold"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f3eadc]"
            }`}
          >
            Trend Hold
          </button>
          <button
            onClick={() => setStrategy("quality_dip")}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
              strategy === "quality_dip"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f3eadc]"
            }`}
          >
            Quality Dip
          </button>
        </div>
        {strategy !== "quality_dip" ? (
        <div className="flex items-center gap-2 rounded-xl border border-[#e3d5bf] bg-[#fcf8f1] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <button
            onClick={() => setUniverseMode("auto")}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
              universeMode === "auto"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f3eadc]"
            }`}
          >
            Auto (latest populated)
          </button>
          <button
            onClick={() => setUniverseMode("core_800")}
            disabled={!isCoreEnabled}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
              universeMode === "core_800"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                : !isCoreEnabled
                ? "cursor-not-allowed border-transparent bg-transparent text-slate-400"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f3eadc]"
            }`}
          >
            Core 800
          </button>
          <button
            onClick={() => setUniverseMode("midcap_1000")}
            disabled={!isMidcapEnabled}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
              universeMode === "midcap_1000"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                : !isMidcapEnabled
                ? "cursor-not-allowed border-transparent bg-transparent text-slate-400"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f3eadc]"
            }`}
          >
            Midcap 1000
          </button>
          <button
            onClick={() => setUniverseMode("liquid_2000")}
            disabled={!isLiquidEnabled}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
              universeMode === "liquid_2000"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                : !isLiquidEnabled
                ? "cursor-not-allowed border-transparent bg-transparent text-slate-400"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f3eadc]"
            }`}
          >
            Liquid 2000
          </button>
          <button
            onClick={() => setUniverseMode("growth_1500")}
            disabled={!isGrowthEnabled}
            className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
              universeMode === "growth_1500"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                : !isGrowthEnabled
                ? "cursor-not-allowed border-transparent bg-transparent text-slate-400"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f3eadc]"
            }`}
          >
            Growth 1500
          </button>
        </div>
        ) : null}
        {strategy !== "quality_dip" ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runMarketDataRefresh}
            disabled={marketRefreshBusy || runScanBusy}
            className="rounded-xl border border-[#d8c8aa] bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-[#f8f1e4] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {marketRefreshBusy ? "Refreshing bars..." : "Refresh Market Data"}
          </button>
          <button
            type="button"
            onClick={() => runStrategyScan("v1", "Momentum Scan")}
            disabled={runScanBusy}
            className="rounded-xl border border-[#d8c8aa] bg-[#f1e4cd] px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-[#ecdcbf] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {runScanBusy && runScanState.label === "Momentum Scan" ? "Running..." : "Run Momentum Scan"}
          </button>
          <button
            type="button"
            onClick={() => runStrategyScan("v1_trend_hold", "Trend Scan")}
            disabled={runScanBusy}
            className="rounded-xl border border-[#d8c8aa] bg-[#f1e4cd] px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-[#ecdcbf] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {runScanBusy && runScanState.label === "Trend Scan" ? "Running..." : "Run Trend Scan"}
          </button>
          <button
            type="button"
            onClick={() => runStrategyScan("v1_sector_momentum", "Sector Scan")}
            disabled={runScanBusy}
            className="rounded-xl border border-[#d8c8aa] bg-[#f1e4cd] px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-[#ecdcbf] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {runScanBusy && runScanState.label === "Sector Scan" ? "Running..." : "Run Sector Scan"}
          </button>
        </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {strategy === "quality_dip" ? (
            <>
              <button
                type="button"
                onClick={runQualityDipRefresh}
                disabled={qualityRefreshBusy}
                className="rounded-xl border border-[#d8c8aa] bg-[#f1e4cd] px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-[#ecdcbf] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {qualityRefreshBusy ? "Refreshing..." : "Refresh Watchlist Bars"}
              </button>
              <span className="surface-chip px-2.5 py-1">
                Watchlist: {qualityDipData?.meta?.watchlist_size ?? qualityRows.length}
              </span>
              <span className="surface-chip px-2.5 py-1">{qualityFreshnessChip}</span>
              <span className="surface-chip px-2.5 py-1">
                SPY trend: {qualityDipData?.meta?.market?.spy_above_sma200 ? "Healthy" : "Weak"}
              </span>
            </>
          ) : (
            <>
              <span className="surface-chip px-2.5 py-1">Regime: {data?.meta?.regime_state ?? "—"}</span>
          {marketDataIsStale ? (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">
              Market data stale
            </span>
          ) : (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
              Market data current
            </span>
          )}
          <span className="surface-chip px-2.5 py-1">
            Latest scan: {data?.meta?.date_used ?? "—"}
            {data?.meta?.read_context_is_fallback ? " (fallback)" : ""}
          </span>
          <span className="surface-chip px-2.5 py-1">
            Universe: {data?.meta?.universe_slug ?? "—"}
            {universeMode === "auto" ? " (auto)" : ""}
          </span>
          <span className="surface-chip px-2.5 py-1">LCTD: {data?.meta?.lctd ?? "—"}</span>
          <span className="surface-chip px-2.5 py-1">
            %&gt;SMA50: {Number(data?.meta?.pct_above_sma50 ?? 0).toFixed(1)}%
          </span>
          <span className="surface-chip px-2.5 py-1">
            %&gt;SMA200: {Number(data?.meta?.pct_above_sma200 ?? 0).toFixed(1)}%
          </span>
          <span
            className={`rounded-full border px-2 py-1 font-semibold ${
              breadth.breadthState === "STRONG"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : breadth.breadthState === "MIXED"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {breadth.breadthState}
          </span>
          {breadth.breadthState !== "STRONG" ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-semibold text-amber-700">
              {breadth.breadthLabel}
            </span>
          ) : null}
          <span className="surface-chip px-2.5 py-1">
            Cash: {Number(data?.capacity?.cash_available ?? 0).toFixed(2)}
          </span>
          <span className="surface-chip px-2.5 py-1">
            Slots: {data?.capacity?.slots_left ?? 0}
          </span>
            </>
          )}
        </div>
      </div>
      {strategy !== "quality_dip" && marketDataIsStale ? (
        <div className="mt-[-8px] rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <div className="font-medium">Market data is stale</div>
          <div className="mt-0.5">
            Ideas is rescanning cached bars, so running a manual scan will not make dates newer until Polygon daily bars are refreshed.
          </div>
          <div className="mt-1">{marketDataReasonSummary}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] opacity-90">
            <span className="surface-chip px-2 py-0.5">
              expected latest trading day: {marketDataStatus?.expected_latest_trading_day ?? "—"}
            </span>
            <span className="surface-chip px-2 py-0.5">
              scheduler last run: {marketDataLastRunLabel}
            </span>
            <span className="surface-chip px-2 py-0.5">
              scheduler last scan date: {marketDataStatus?.scheduler_last_scan_date ?? "—"}
            </span>
            <span className="surface-chip px-2 py-0.5">
              scheduler ok: {marketDataStatus?.scheduler_last_ok ? "yes" : "no"}
            </span>
          </div>
        </div>
      ) : null}
      {strategy !== "quality_dip" && marketRefreshState.status !== "idle" ? (
        <div
          className={`mt-[-8px] rounded-xl border px-3 py-2 text-xs ${
            marketRefreshState.status === "failed"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : marketRefreshState.status === "running"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          <div className="font-medium">
            {marketRefreshState.status === "running"
              ? "Market data refresh running"
              : marketRefreshState.status === "completed"
                ? "Market data refresh completed"
                : "Market data refresh failed"}
          </div>
          <div className="mt-0.5">{marketDataRefreshDetail}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] opacity-90">
            <span className="surface-chip px-2 py-0.5">scan date: {marketRefreshState.scanDate ?? "—"}</span>
            <span className="surface-chip px-2 py-0.5">
              duration: {marketRefreshState.durationMs != null ? `${marketRefreshState.durationMs}ms` : "—"}
            </span>
          </div>
          {marketRefreshState.error ? <div className="mt-1 text-[11px]">{marketRefreshState.error}</div> : null}
        </div>
      ) : null}
      {strategy === "quality_dip" && qualityRefreshState.status !== "idle" ? (
        <div
          className={`mt-[-8px] rounded-xl border px-3 py-2 text-xs ${
            qualityRefreshState.status === "failed"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : qualityRefreshState.status === "running"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          <div className="font-medium">
            {qualityRefreshState.status === "running"
              ? "Quality Dip refresh running"
              : qualityRefreshState.status === "completed"
                ? "Quality Dip refresh completed"
                : "Quality Dip refresh failed"}
          </div>
          <div className="mt-0.5">{qualityRefreshState.detail ?? "—"}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] opacity-90">
            <span className="surface-chip px-2 py-0.5">
              symbols: {qualityRefreshState.symbolsSucceeded}/{qualityRefreshState.symbolsAttempted}
            </span>
            <span className="surface-chip px-2 py-0.5">rows upserted: {qualityRefreshState.rowsUpserted}</span>
            <span className="surface-chip px-2 py-0.5">
              expected date: {qualityRefreshState.expectedMarketDate ?? "—"}
            </span>
            <span className="surface-chip px-2 py-0.5">latest bar: {qualityRefreshState.latestBarDate ?? "—"}</span>
            <span className="surface-chip px-2 py-0.5">
              duration: {qualityRefreshState.durationMs != null ? `${qualityRefreshState.durationMs}ms` : "—"}
            </span>
          </div>
          {qualityRefreshState.error ? <div className="mt-1 text-[11px]">{qualityRefreshState.error}</div> : null}
        </div>
      ) : null}
      {strategy !== "quality_dip" && runScanState.status !== "idle" ? (
        <div
          className={`mt-[-8px] rounded-xl border px-3 py-2 text-xs ${
            runScanState.status === "failed"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : runScanState.status === "running" || runScanState.status === "starting"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : runScanState.status === "completed_zero"
                  ? "border-slate-300 bg-slate-50 text-slate-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          <div className="font-medium">
            {runScanState.status === "starting"
              ? "Manual scan starting"
              : runScanState.status === "running"
                ? "Manual scan running"
                : runScanState.status === "completed"
                  ? "Manual scan completed"
                  : runScanState.status === "completed_zero"
                    ? "Manual scan completed (0 processed rows)"
                    : "Manual scan failed"}
          </div>
          <div className="mt-0.5">{runScanState.detail ?? "—"}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] opacity-90">
            <span className="surface-chip px-2 py-0.5">request: {runScanState.requestId ?? "—"}</span>
            <span className="surface-chip px-2 py-0.5">strategy: {runScanState.strategyResolved ?? runScanState.strategyRequested ?? "—"}</span>
            <span className="surface-chip px-2 py-0.5">
              universes: {(runScanState.universeResolved ?? []).join(", ") || "—"}
            </span>
            <span className="surface-chip px-2 py-0.5">bars: {runScanState.barsMode ?? "—"}</span>
            <span className="surface-chip px-2 py-0.5">date: {runScanState.scanDate ?? "—"}</span>
            <span className="surface-chip px-2 py-0.5">rows processed: {runScanState.rowsWritten}</span>
            <span className="surface-chip px-2 py-0.5">rows net-new: {runScanState.rowsNew}</span>
            <span className="surface-chip px-2 py-0.5">
              batches: {runScanState.batchesCompleted}
              {runScanState.totalBatches != null ? `/${runScanState.totalBatches}` : ""}
            </span>
            <span className="surface-chip px-2 py-0.5">symbols processed: {runScanState.symbolsProcessed}</span>
            <span className="surface-chip px-2 py-0.5">
              context rows: {runScanState.contextRowCount != null ? runScanState.contextRowCount : "—"}
            </span>
            <span className="surface-chip px-2 py-0.5">context match: {readContextMatchesLatestManualScan ? "yes" : "no"}</span>
            <span className="surface-chip px-2 py-0.5">
              duration: {runScanState.durationMs != null ? `${runScanState.durationMs}ms` : "—"}
            </span>
          </div>
          {showingExistingRowsAfterZeroScan ? (
            <div className="mt-1 text-[11px]">
              This run produced 0 new rows; Ideas is showing existing cached rows for the same scan context.
            </div>
          ) : null}
        </div>
      ) : null}
      {strategy !== "quality_dip" ? (
      <div className="mt-[-8px] text-[11px] text-slate-500">
        Auto selects the latest populated universe for each strategy. Unavailable explicit universes are marked as not scanned yet.
      </div>
      ) : null}

      {strategy !== "quality_dip" ? (
      <div className="surface-card px-3.5 py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Idea Pulse</div>
        <div className="grid gap-2 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
              <div className="text-[10px] text-slate-500">Actionable today</div>
              <div className="text-sm font-semibold text-slate-900">{Number(candidateStateCounts?.actionable_today ?? 0)}</div>
            </div>
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
              <div className="text-[10px] text-slate-500">Near entry</div>
              <div className="text-sm font-semibold text-slate-900">{Number(candidateStateCounts?.near_entry ?? 0)}</div>
            </div>
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
              <div className="text-[10px] text-slate-500">Quality watch</div>
              <div className="text-sm font-semibold text-slate-900">{Number(candidateStateCounts?.quality_watch ?? 0)}</div>
            </div>
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
              <div className="text-[10px] text-slate-500">Extended leaders</div>
              <div className="text-sm font-semibold text-slate-900">{Number(candidateStateCounts?.extended_leader ?? 0)}</div>
            </div>
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
              <div className="text-[10px] text-slate-500">Blocked</div>
              <div className="text-sm font-semibold text-slate-900">{Number(candidateStateCounts?.blocked ?? 0)}</div>
            </div>
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
              <div className="text-[10px] text-slate-500">Improving / new</div>
              <div className="text-sm font-semibold text-slate-900">
                {Number(changeSummary?.upgraded_count ?? 0) + Number(changeSummary?.new_count ?? 0)}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Closest To Actionable</div>
            <div className="mt-2 space-y-2">
              {closestToActionable.length === 0 ? (
                <div className="text-[11px] text-slate-500">No near-actionable names in the loaded set.</div>
              ) : (
                closestToActionable.slice(0, 3).map((row) => (
                  <div key={row.symbol} className="rounded-lg border border-[#efe5d6] bg-white px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">{row.symbol}</div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${candidateStatePill(row.candidate_state)}`}>
                        {row.candidate_state_label ?? row.candidate_state ?? "—"}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-600">{row.dossier_summary ?? "—"}</div>
                    {Array.isArray(row.blockers) && row.blockers.length > 0 ? (
                      <div className="mt-1 text-[10px] text-slate-500">Main blocker: {row.blockers[0]}</div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Change Vs Prior Scan</div>
            <div className="mt-2 space-y-2">
              {improvingRows.length === 0 ? (
                <div className="text-[11px] text-slate-500">No new or upgraded names in the loaded set.</div>
              ) : (
                improvingRows.slice(0, 3).map((row) => (
                  <div key={`${row.symbol}-${row.change_status}`} className="rounded-lg border border-[#efe5d6] bg-white px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">{row.symbol}</div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${changePill(row.change_status)}`}>
                        {row.change_status ?? "—"}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-600">{row.change_label ?? "—"}</div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      {row.candidate_state_label ?? "State —"}
                      {typeof row.quality_score === "number" ? ` • quality ${row.quality_score.toFixed(0)}` : ""}
                    </div>
                  </div>
                ))
              )}
              {blockerSummary.length > 0 ? (
                <div className="rounded-lg border border-[#efe5d6] bg-white px-2.5 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Top blockers</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {blockerSummary.slice(0, 4).map((item) => (
                      <span key={item.label} className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                        {item.label} ({item.count})
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      ) : null}

      {strategy !== "quality_dip" ? (
      <div className="surface-card px-3.5 py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Signal Funnel</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
          <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
            <div className="text-[10px] text-slate-500">Rows loaded</div>
            <div className="text-sm font-semibold text-slate-900">{funnel.rowsRaw}</div>
          </div>
          <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
            <div className="text-[10px] text-slate-500">After validation</div>
            <div className="text-sm font-semibold text-slate-900">{funnel.rowsValidated}</div>
          </div>
          <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
            <div className="text-[10px] text-slate-500">BUY in loaded set</div>
            <div className="text-sm font-semibold text-slate-900">{funnel.buyCount}</div>
          </div>
          <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
            <div className="text-[10px] text-slate-500">WATCH in loaded set</div>
            <div className="text-sm font-semibold text-slate-900">{funnel.watchCount}</div>
          </div>
          <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
            <div className="text-[10px] text-slate-500">BUY in zone</div>
            <div className="text-sm font-semibold text-slate-900">{funnel.buyInZone}</div>
          </div>
          <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
            <div className="text-[10px] text-slate-500">BUY not skipped</div>
            <div className="text-sm font-semibold text-slate-900">{funnel.buyNotSkipped}</div>
          </div>
          <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] px-2.5 py-2">
            <div className="text-[10px] text-slate-500">Final actionable</div>
            <div className="text-sm font-semibold text-slate-900">{funnel.finalActionable}</div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-slate-500">
          Counts scope: {funnel.scope}. Query limit: {funnel.queryLimit || allRows.length}. Displayed rows after ranking caps: {funnel.rowsDisplay}. Execution-stage counts are computed from loaded rows ({allRows.length}).
        </div>
      </div>
      ) : null}

      {showDiagnostics ? (
        <div className="surface-card px-3.5 py-2.5 text-[11px] text-slate-600">
          build={buildMarker}
          {" • "}page_marker={pageMarker}
          {" • "}strategy_param={strategyParamRaw ?? "—"}
          {" • "}resolved_strategy_tab={strategy}
          {" • "}selected_universe={universeMode}
          {" • "}selected_universe_mode={universeMode === "auto" ? "auto_latest_populated" : "explicit"}
          {" • "}meta_universe_mode={data?.meta?.selected_universe_mode ?? "—"}
          {" • "}strategy_version={data?.meta?.strategy_version ?? strategy}
          {" • "}filter={selectedFilter}
          {" • "}universe={data?.meta?.universe_slug ?? "—"}
          {" • "}requested_universe={data?.meta?.requested_universe_slug ?? "—"}
          {" • "}selected_universe_has_rows={String(Boolean(data?.meta?.selected_universe_has_rows))}
          {" • "}core_has_scans={String(Boolean(coreAvailability?.has_scans))}
          {" • "}core_latest={coreAvailability?.latest_date ?? "—"}
          {" • "}midcap_has_scans={String(Boolean(midcapAvailability?.has_scans))}
          {" • "}midcap_latest={midcapAvailability?.latest_date ?? "—"}
          {" • "}liquid_has_scans={String(Boolean(liquidAvailability?.has_scans))}
          {" • "}liquid_latest={liquidAvailability?.latest_date ?? "—"}
          {" • "}growth_has_scans={String(Boolean(growthAvailability?.has_scans))}
          {" • "}growth_latest={growthAvailability?.latest_date ?? "—"}
          {" • "}requested_date={data?.meta?.requested_date ?? "—"}
          {" • "}rows={rows.length}
          {" • "}rows_filtered={filteredRows.length}
          {" • "}date_used={data?.meta?.date_used ?? "—"}
          {" • "}lctd={data?.meta?.lctd ?? "—"}
          {" • "}source={data?.meta?.data_source ?? "—"}
          {" • "}fallbacks={(data?.meta?.fallback_decisions ?? []).join(" > ") || "none"}
          {" • "}raw={Number(data?.meta?.rows_raw_count ?? 0)}
          {" • "}validated={Number(data?.meta?.rows_after_validation_count ?? 0)}
          {" • "}display={Number(data?.meta?.rows_display_count ?? 0)}
          {" • "}count_scope={data?.meta?.rows_count_scope ?? "—"}
          {" • "}query_limit={Number(data?.meta?.rows_query_limit ?? 0)}
          {" • "}signals_raw={JSON.stringify(data?.meta?.rows_signal_counts_raw ?? {})}
          {" • "}signals_validated={JSON.stringify(data?.meta?.rows_signal_counts_validated ?? {})}
          {" • "}signals_display={JSON.stringify(data?.meta?.rows_signal_counts_display ?? {})}
          {" • "}shape_raw={String(Boolean(data?.meta?.response_shape?.raw_rows_is_array))}
          {" • "}shape_validated={String(Boolean(data?.meta?.response_shape?.validated_rows_is_array))}
          {" • "}shape_final={String(Boolean(data?.meta?.response_shape?.final_rows_is_array))}
          {" • "}read_context_key={data?.meta?.read_context_key ?? "—"}
          {" • "}read_context_is_fallback={String(Boolean(data?.meta?.read_context_is_fallback))}
          {" • "}read_context_matches_manual_scan={String(readContextMatchesLatestManualScan)}
          {" • "}ok={loading ? "loading" : lastLoadOk === null ? "unknown" : lastLoadOk ? "true" : "false"}
          {" • "}api={strategy === "quality_dip" ? lastQualityApiUrl || lastApiUrl || "—" : lastApiUrl || "—"}
          {" • "}quality_rows={qualityRows.length}
          {" • "}quality_consider_buy={qualitySummary.consider_buy}
          {" • "}quality_watch={qualitySummary.watch}
          {" • "}quality_avoid={qualitySummary.avoid}
          {" • "}quality_freshness_state={qualityFreshness?.state ?? "—"}
          {" • "}quality_expected_date={qualityFreshness?.expected_date ?? "—"}
          {" • "}quality_latest_symbol_date={qualityFreshness?.latest_symbol_date ?? "—"}
          {" • "}quality_oldest_symbol_date={qualityFreshness?.oldest_symbol_date ?? "—"}
          {" • "}quality_stale_symbols_count={qualityFreshness?.stale_symbols_count ?? 0}
          {" • "}quality_refresh_status={qualityRefreshState.status}
          {" • "}quality_refresh_rows_upserted={qualityRefreshState.rowsUpserted}
          {" • "}quality_refresh_expected_date={qualityRefreshState.expectedMarketDate ?? "—"}
          {" • "}quality_refresh_latest_bar={qualityRefreshState.latestBarDate ?? "—"}
          {" • "}scan_status={runScanState.status}
          {" • "}scan_request_id={runScanState.requestId ?? "—"}
          {" • "}scan_rows_written={runScanState.rowsWritten}
          {" • "}scan_rows_new={runScanState.rowsNew}
          {" • "}scan_batches_completed={runScanState.batchesCompleted}
          {" • "}scan_total_batches={runScanState.totalBatches ?? "—"}
          {" • "}scan_symbols_processed={runScanState.symbolsProcessed}
          {" • "}scan_context_rows={runScanState.contextRowCount ?? "—"}
          {" • "}scan_context_keys={(runScanState.contextKeys ?? []).join(",") || "—"}
          {" • "}scan_date={runScanState.scanDate ?? "—"}
          {" • "}scan_error={runScanState.error ?? "—"}
          {" • "}strategy_date_hint={scanDateHintByStrategy[strategy] ?? "—"}
          {" • "}cache_bust={data?.meta?.cache_bust ?? "—"}
          {" • "}market_data_stale={String(Boolean(data?.meta?.market_data_status?.is_stale))}
          {" • "}market_data_reasons={(data?.meta?.market_data_status?.reasons ?? []).join(" > ") || "none"}
          {" • "}market_data_expected={data?.meta?.market_data_status?.expected_latest_trading_day ?? "—"}
          {" • "}market_scheduler_last_run={data?.meta?.market_data_status?.scheduler_last_run_at ?? "—"}
          {" • "}market_scheduler_last_scan={data?.meta?.market_data_status?.scheduler_last_scan_date ?? "—"}
          {" • "}market_scheduler_ok={String(Boolean(data?.meta?.market_data_status?.scheduler_last_ok))}
          {" • "}market_refresh_status={marketRefreshState.status}
          {" • "}market_refresh_scan_date={marketRefreshState.scanDate ?? "—"}
          {" • "}market_refresh_error={marketRefreshState.error ?? "—"}
        </div>
      ) : null}

      <div className="surface-panel overflow-hidden">
        {strategy === "quality_dip" ? (
          <>
            {loading ? <div className="p-5 text-sm text-slate-600">Loading Quality Dip watchlist…</div> : null}
            {!loading && !qualityDipData?.ok ? (
              <div className="p-5 text-sm text-rose-600">Failed: {qualityDipData?.error ?? "Unknown error"}</div>
            ) : null}
            {!loading && qualityDipData?.ok ? (
              <>
                <div className="border-b border-[#e2d2b7] bg-[#fffaf2] px-4 py-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <div className="text-[11px] text-emerald-700">Consider Buy</div>
                      <div className="text-lg font-semibold text-emerald-800">{qualitySummary.consider_buy}</div>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <div className="text-[11px] text-amber-700">Watch</div>
                      <div className="text-lg font-semibold text-amber-800">{qualitySummary.watch}</div>
                    </div>
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                      <div className="text-[11px] text-rose-700">Avoid</div>
                      <div className="text-lg font-semibold text-rose-800">{qualitySummary.avoid}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-500">Filter:</span>
                    {([
                      { key: "all", label: "All" },
                      { key: "consider_buy", label: "Consider Buy" },
                      { key: "watch", label: "Watch" },
                      { key: "avoid", label: "Avoid" },
                    ] as Array<{ key: QualityDipFilter; label: string }>).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setQualityFilter(f.key)}
                        className={`rounded-full border px-2.5 py-1 font-medium transition ${
                          qualityFilter === f.key
                            ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900"
                            : "border-[#e4d5be] bg-[#fffdf8] text-slate-600 hover:bg-[#f7efe1]"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                    <span className="ml-2 text-slate-500">Sort:</span>
                    <select
                      value={qualitySort}
                      onChange={(e) => setQualitySort(e.target.value as QualityDipSort)}
                      className="rounded-lg border border-[#dcc9aa] bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      <option value="signal">Signal</option>
                      <option value="drop">% Drop</option>
                      <option value="price">Price</option>
                      <option value="symbol">Symbol</option>
                    </select>
                    <span className="ml-2 text-[11px] text-slate-500">
                      Dip reference uses the highest high from the last 30 trading bars.
                    </span>
                  </div>
                  {Array.isArray(qualityDipData?.meta?.missing_symbols) && qualityDipData.meta!.missing_symbols!.length > 0 ? (
                    <div className="mt-2 text-[11px] text-slate-500">
                      Missing/insufficient bars: {qualityDipData.meta!.missing_symbols!.join(", ")}
                    </div>
                  ) : null}
                  {qualityFreshness?.state && qualityFreshness.state !== "current" ? (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {qualityFreshness.state === "mixed"
                        ? `Mixed freshness: ${qualityFreshness.stale_symbols_count ?? 0} symbols are behind SPY ${qualityFreshness.expected_date ?? "—"}`
                        : `Freshness stale: watchlist bars lag SPY ${qualityFreshness.expected_date ?? "—"}`}
                      {staleQualityPreview ? ` (${staleQualityPreview}${staleQualitySymbols.length > 6 ? ", …" : ""})` : ""}
                    </div>
                  ) : null}
                </div>
                <table className="w-full table-fixed text-sm leading-5">
                  <thead className="text-left text-[11px] text-slate-500">
                    <tr className="border-b border-[#e2d2b7]">
                      <th className="px-3 py-2.5">Symbol</th>
                      <th className="px-3 py-2.5">Company</th>
                      <th className="px-3 py-2.5">Price</th>
                      <th className="px-3 py-2.5">% Drop</th>
                      <th className="px-3 py-2.5">Context</th>
                      <th className="px-3 py-2.5">Signal</th>
                      <th className="px-3 py-2.5">Trade Levels</th>
                      <th className="px-3 py-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualityGroupedRows.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-sm text-slate-600" colSpan={8}>
                          No Quality Dip rows available.
                        </td>
                      </tr>
                    ) : null}
                    {qualityGroupedRows.map((group) => (
                      <Fragment key={group.group}>
                        <tr className="border-b border-[#eee2cf] bg-[#fff7eb]">
                          <td colSpan={8} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                            {group.group}
                          </td>
                        </tr>
                        {group.rows.map((row) => (
                          <tr key={row.symbol} className="border-b border-[#efe5d6]">
                            <td className="px-3 py-2.5 font-semibold tracking-tight">{row.symbol}</td>
                            <td className="px-3 py-2.5">
                              <div className="truncate text-slate-800" title={row.name}>
                                {row.name}
                              </div>
                              <div className="truncate text-[11px] text-slate-500" title={row.reason_summary}>
                                {row.reason_summary}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">{row.current_price != null ? row.current_price.toFixed(2) : "—"}</td>
                            <td className="px-3 py-2.5">
                              {row.drop_pct_from_30d_high != null ? `${row.drop_pct_from_30d_high.toFixed(2)}%` : "—"}
                              {row.high_30d != null ? (
                                <div className="text-[10px] text-slate-500" title="Highest high across the last 30 trading bars">
                                  30-bar high {row.high_30d.toFixed(2)}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-col gap-1">
                                <span
                                  className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                                  row.stock_above_sma200 == null
                                    ? "border-slate-200 bg-slate-50 text-slate-600"
                                    : row.stock_above_sma200
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-rose-200 bg-rose-50 text-rose-700"
                                  }`}
                                >
                                  {row.stock_above_sma200 == null ? "SMA200 N/A" : row.stock_above_sma200 ? "Above SMA200" : "Below SMA200"}
                                </span>
                                <span
                                  className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                                    row.market_spy_above_sma200
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-amber-200 bg-amber-50 text-amber-700"
                                  }`}
                                >
                                  {row.market_spy_above_sma200 ? "SPY Healthy" : "SPY Weak"}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${qualitySignalPill(row.signal)}`}>
                                {row.signal === "CONSIDER_BUY" ? "Consider Buy" : row.signal}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-[11px] text-slate-600 whitespace-nowrap">
                              {row.current_price != null ? (
                                <>
                                  E {row.current_price.toFixed(2)} · S {(row.current_price * 0.94).toFixed(2)}
                                  <div>TP { (row.current_price * 1.06).toFixed(2)} / {(row.current_price * 1.12).toFixed(2)}</div>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              {row.signal !== "AVOID" ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const mapped = toQualityDipTradeRow(row);
                                    if (!mapped) return;
                                    openTradeTicket(mapped);
                                  }}
                                  className="rounded-lg border border-[#dcc9aa] bg-[#f8f0e2] px-2.5 py-1 text-[10px] font-semibold text-slate-700 whitespace-nowrap hover:bg-[#f2e6d4]"
                                >
                                  {row.signal === "CONSIDER_BUY" ? "Paper Trade" : "Prepare Trade"}
                                </button>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </>
        ) : null}
        {strategy !== "quality_dip" ? (
          <>
            {loading ? <div className="p-5 text-sm text-slate-600">Loading ideas…</div> : null}
            {!loading && !data?.ok ? <div className="p-5 text-sm text-rose-600">Failed: {data?.error ?? "Unknown error"}</div> : null}
            {!loading && data?.ok ? (
          <>
            <div className="border-b border-[#e2d2b7] bg-[#fffaf2] px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">Filter:</span>
                {([
                  { key: "all", label: "All" },
                  { key: "buy", label: "BUY" },
                  { key: "watch", label: "WATCH" },
                  { key: "actionable", label: "Actionable" },
                ] as Array<{ key: IdeasFilter; label: string }>).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setSelectedFilter(f.key)}
                    className={`rounded-full border px-2.5 py-1 font-medium transition ${
                      selectedFilter === f.key
                        ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900"
                        : "border-[#e4d5be] bg-[#fffdf8] text-slate-600 hover:bg-[#f7efe1]"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <table className="w-full text-sm leading-6">
              <thead className="text-left text-xs text-slate-500">
                <tr className="border-b border-[#e2d2b7]">
                  <th className="px-4 py-3.5">Symbol</th>
                  <th className="px-4 py-3.5">Signal</th>
                  <th className="px-4 py-3.5">Rank</th>
                  <th className="px-4 py-3.5">Quality</th>
                  <th className="px-4 py-3.5">Entry</th>
                  <th className="px-4 py-3.5">Live</th>
                  <th className="px-4 py-3.5">Delta</th>
                  <th className="px-4 py-3.5">Stop</th>
                  <th className="px-4 py-3.5">TP1</th>
                  <th className="px-4 py-3.5">Zone</th>
                  <th className="px-4 py-3.5">Action</th>
                  <th className="px-4 py-3.5">Position Cost</th>
                  <th className="px-4 py-3.5">Quick</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-5 text-sm text-slate-600" colSpan={13}>
                      {emptyStateMessage ?? "No rows available."}
                    </td>
                  </tr>
                ) : null}
                {filteredRows.map((row) => {
                const q = quoteBySymbol[row.symbol];
                const sym = String(row.symbol ?? "").trim().toUpperCase();
                const earnings = earningsBySymbol[sym] ?? null;
                const rawLive = typeof q?.price === "number" && Number.isFinite(q.price) ? q.price : null;
                const entry = Number(row.entry ?? 0);
                const mismatch =
                  rawLive !== null &&
                  entry > 0 &&
                  Math.abs((rawLive - entry) / entry) > PRICE_MISMATCH_THRESHOLD_PCT;
                const live = mismatch ? null : rawLive;
                const deltaPct = live !== null && entry > 0 ? ((live - entry) / entry) * 100 : null;
                const reason = mismatch
                    ? "Price mismatch"
                    : live !== null
                    ? getEntryStatus({
                        price: live,
                        zone_low: getBuyZone({ strategy_version: strategy, model_entry: Number(row.entry) }).zone_low,
                        zone_high: getBuyZone({ strategy_version: strategy, model_entry: Number(row.entry) }).zone_high,
                      })
                    : "No live price";
                const zoneStatus =
                  live === null || !Number.isFinite(entry) || entry <= 0
                    ? null
                    : reason === "Below trigger"
                    ? "BELOW_TRIGGER"
                    : live <= entry
                    ? "IN_ZONE"
                    : live <= entry * 1.02
                    ? "ABOVE_ENTRY"
                    : "TOO_EXTENDED";
                const exec = applyBreadthToAction(
                  applyEarningsRiskToAction(mapExecutionState(reason), earnings),
                  breadth
                );
                return (
                  <tr
                    key={row.symbol}
                    className="cursor-pointer border-b border-[#efe5d6] transition-colors hover:bg-[#fff9f0]"
                    onClick={() => openTradeTicket(row)}
                  >
                    <td className="px-4 py-3.5 font-semibold tracking-tight">
                      <div>{row.symbol}</div>
                      {row.candidate_state_label ? (
                        <div className="mt-1">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${candidateStatePill(row.candidate_state)}`}>
                            {row.candidate_state_label}
                          </span>
                        </div>
                      ) : null}
                      {row.industry_group ? (
                        <div className="mt-0.5 text-[10px] font-normal text-slate-500">{row.industry_group}</div>
                      ) : null}
                      {row.setup_type ? (
                        <div className="mt-0.5 text-[10px] font-normal text-slate-500">{row.setup_type}</div>
                      ) : null}
                      {row.change_status ? (
                        <div className="mt-1">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${changePill(row.change_status)}`}>
                            {row.change_status}
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${signalPill(row.signal)}`}>
                        {row.signal}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">{row.rank ?? "—"}</td>
                    <td className="px-4 py-3.5">
                      <div className="font-semibold">{Number(row.quality_score ?? row.confidence ?? 0).toFixed(0)}</div>
                      <div className="text-[10px] text-slate-500">
                        {row.risk_grade ? `Risk ${row.risk_grade}` : "Risk —"}
                      </div>
                      {row.dossier_summary ? (
                        <div className="mt-1 max-w-[16rem] text-[10px] leading-4 text-slate-500">
                          {row.dossier_summary}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5">{entry.toFixed(2)}</td>
                    <td className="px-4 py-3.5">
                      {live !== null ? live.toFixed(2) : "—"}
                      {mismatch ? <span className="ml-2 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">MISMATCH</span> : null}
                    </td>
                    <td className="px-4 py-3.5">{fmtSignedPct(deltaPct)}</td>
                    <td className="px-4 py-3.5">{Number(row.stop ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-3.5">{Number(row.tp1 ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-3.5">
                      {zoneStatus ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                            zoneStatus === "IN_ZONE"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : zoneStatus === "ABOVE_ENTRY"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : zoneStatus === "BELOW_TRIGGER"
                              ? "border-sky-200 bg-sky-50 text-sky-700"
                              : "border-rose-200 bg-rose-50 text-rose-700"
                          }`}
                        >
                          {zoneStatus}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="space-y-1">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${actionPill(exec.action)}`}>
                          {exec.action}
                        </span>
                        <div className="text-[11px] text-slate-500">{exec.reasonLabel}</div>
                        {earnings?.earningsLabel ? (
                          <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            {earnings.earningsLabel}
                          </div>
                        ) : null}
                        {exec.breadthLabel ? (
                          <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            {exec.breadthLabel}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">{Number(row.sizing?.est_cost ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-3.5">
                      {row.signal === "BUY" || row.signal === "WATCH" ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTradeTicket(row);
                          }}
                          className="rounded-lg border border-[#dcc9aa] bg-[#f8f0e2] px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-[#f2e6d4]"
                        >
                          Paper Trade
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          </>
        ) : null}
          </>
        ) : null}
      </div>

      <div
        ref={tradeTicketRef}
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-xl transform border-l border-[#decdae] bg-[#fff8ee] shadow-[0_18px_40px_rgba(60,42,20,0.18)] transition ${
          selected ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selected ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[#e3d2b6] px-4 py-3">
              <div>
                <div className="text-lg font-semibold">{selected.symbol}</div>
                <div className="text-xs text-slate-500">
                  {strategy === "v1_trend_hold"
                    ? "Trend Hold"
                    : strategy === "v1_sector_momentum"
                    ? "Sector Momentum"
                    : strategy === "quality_dip"
                    ? "Quality Dip"
                    : "Momentum Swing"}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg border border-[#dcc9aa] bg-[#f3e7d3] px-2.5 py-1 text-xs font-medium">
                Close
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                  <div className="text-xs text-slate-500">Model entry</div>
                  <div className="mt-1 font-semibold">{selected.entry.toFixed(2)}</div>
                </div>
                <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                  <div className="text-xs text-slate-500">Stop</div>
                  <div className="mt-1 font-semibold">{selected.stop.toFixed(2)}</div>
                </div>
              </div>

              <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Idea dossier</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {selected.setup_type ?? "Setup context unavailable"}
                    </div>
                  </div>
                  {selected.candidate_state_label ? (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${candidateStatePill(
                        selected.candidate_state
                      )}`}
                    >
                      {selected.candidate_state_label}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-600">
                  {selected.dossier_summary ?? selected.reason_summary ?? "No dossier summary available."}
                </div>
                {Array.isArray(selected.blockers) && selected.blockers.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-[11px] font-medium text-slate-500">Current blockers</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {selected.blockers.slice(0, 4).map((blocker) => (
                        <span
                          key={blocker}
                          className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
                        >
                          {blocker}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {Array.isArray(selected.watch_items) && selected.watch_items.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-[11px] font-medium text-slate-500">What to watch</div>
                    <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                      {selected.watch_items.slice(0, 3).map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {selected.change_status ? (
                  <div className="mt-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${changePill(
                        selected.change_status
                      )}`}
                    >
                      {selected.change_status}
                    </span>
                    {selected.change_label ? (
                      <div className="mt-1 text-[11px] text-slate-500">{selected.change_label}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                <div className="text-xs text-slate-500">Daily symbol facts</div>
                {selected.symbol_facts ? (
                  <>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                      <div>Trend: {selected.symbol_facts.trend_state ?? "—"}</div>
                      <div>Extension: {selected.symbol_facts.extension_state ?? "—"}</div>
                      <div>Rel vol: {typeof selected.symbol_facts.relative_volume === "number" ? selected.symbol_facts.relative_volume.toFixed(2) : "—"}</div>
                      <div>ATR %: {typeof selected.symbol_facts.atr_ratio === "number" ? `${(selected.symbol_facts.atr_ratio * 100).toFixed(2)}%` : "—"}</div>
                      <div>30-bar high: {typeof selected.symbol_facts.high_30bar === "number" ? selected.symbol_facts.high_30bar.toFixed(2) : "—"}</div>
                      <div>Drop from high: {typeof selected.symbol_facts.drop_from_30bar_high_pct === "number" ? `${selected.symbol_facts.drop_from_30bar_high_pct.toFixed(2)}%` : "—"}</div>
                      <div>Dist vs SMA50: {typeof selected.symbol_facts.distance_from_sma50_pct === "number" ? `${selected.symbol_facts.distance_from_sma50_pct.toFixed(2)}%` : "—"}</div>
                      <div>Dist vs SMA200: {typeof selected.symbol_facts.distance_from_sma200_pct === "number" ? `${selected.symbol_facts.distance_from_sma200_pct.toFixed(2)}%` : "—"}</div>
                      <div>Liquidity: {selected.symbol_facts.liquidity_state ?? "—"}</div>
                      <div>Volatility: {selected.symbol_facts.volatility_state ?? "—"}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          selected.symbol_facts.above_sma50
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                        }`}
                      >
                        {selected.symbol_facts.above_sma50 ? "Above SMA50" : "Below SMA50"}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          selected.symbol_facts.above_sma200
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                        }`}
                      >
                        {selected.symbol_facts.above_sma200 ? "Above SMA200" : "Below SMA200"}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-xs text-slate-500">
                    Daily facts are not available yet for this row.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">Trade prep</div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      selected.trade_risk_layer?.prep_state === "READY"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : selected.trade_risk_layer?.prep_state === "BLOCKED"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    {selected.trade_risk_layer?.prep_state ?? "REVIEW"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {selected.trade_risk_layer?.summary ?? "Trade-prep metadata unavailable."}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                  <div>Risk/share: {Number(selected.trade_risk_layer?.risk?.risk_per_share ?? 0).toFixed(2)}</div>
                  <div>Stop %: {Number(selected.trade_risk_layer?.risk?.stop_pct ?? 0).toFixed(2)}%</div>
                  <div>RR TP1: {Number(selected.trade_risk_layer?.risk?.rr_tp1 ?? 0).toFixed(2)}</div>
                  <div>RR TP2: {Number(selected.trade_risk_layer?.risk?.rr_tp2 ?? 0).toFixed(2)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                  <div className="text-xs text-slate-500">Buy zone</div>
                  <div className="mt-1 font-semibold">
                    {zone.zone_low.toFixed(2)} - {zone.zone_high.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                  <div className="text-xs text-slate-500">Live price</div>
                  <div className="mt-1 font-semibold">
                    {livePrice != null && selected.entry > 0 && Math.abs((livePrice - selected.entry) / selected.entry) <= PRICE_MISMATCH_THRESHOLD_PCT
                      ? livePrice.toFixed(2)
                      : "—"}
                  </div>
                  <div className="mt-2 space-y-1">
                    {(() => {
                      const sym = String(selected.symbol ?? "").trim().toUpperCase();
                      const earnings = earningsBySymbol[sym] ?? null;
                      const mismatch =
                        livePrice != null &&
                        selected.entry > 0 &&
                        Math.abs((livePrice - selected.entry) / selected.entry) > PRICE_MISMATCH_THRESHOLD_PCT;
                      const reason = mismatch ? "Price mismatch" : livePrice != null ? entryStatus : "No live price";
                      const exec = applyBreadthToAction(
                        applyEarningsRiskToAction(mapExecutionState(reason), earnings),
                        breadth
                      );
                      return (
                        <>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${actionPill(exec.action)}`}>
                            {exec.action}
                          </span>
                          <div className="text-[11px] text-slate-500">{exec.reasonLabel}</div>
                          {earnings?.earningsLabel ? (
                            <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              {earnings.earningsLabel}
                            </div>
                          ) : null}
                          {exec.breadthLabel ? (
                            <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              {exec.breadthLabel}
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                <label className="block text-xs text-slate-500">Your entry</label>
                <input
                  ref={entryInputRef}
                  value={fill}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFill(next);
                    const n = Number(next);
                    if (Number.isFinite(n) && n > 0 && selected.stop > 0 && riskBudget > 0) {
                      const nextRisk = n - selected.stop;
                      if (nextRisk > 0) {
                        const nextByRisk = Math.max(0, Math.floor(riskBudget / nextRisk));
                        const nextByCash =
                          Number.isFinite(cashAvailableForSizing) && n > 0 ? Math.max(0, Math.floor(cashAvailableForSizing / n)) : 0;
                        const nextCap =
                          typeof selected?.sizing?.shares_by_portfolio_cap === "number" &&
                          Number.isFinite(selected.sizing.shares_by_portfolio_cap)
                            ? Math.max(0, Math.floor(selected.sizing.shares_by_portfolio_cap))
                            : null;
                        const nextCandidates = [nextByRisk, nextByCash, ...(nextCap != null ? [nextCap] : [])];
                        setShares(String(Math.max(0, Math.min(...nextCandidates))));
                      }
                    }
                  }}
                  className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                  inputMode="decimal"
                />
                <label className="block text-xs text-slate-500">Shares</label>
                <input
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                  inputMode="numeric"
                />
                <div className="text-xs text-slate-600">
                  Suggested shares (fill-aware): <span className="font-semibold">{suggestedShares}</span>
                </div>
                <div className="text-xs text-slate-500">Cash-only sizing. {limitingFactor}.</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500">Entry fee</label>
                    <input
                      value={entryFee}
                      onChange={(e) => setEntryFee(e.target.value)}
                      className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Exit fee</label>
                    <input
                      value={exitFee}
                      onChange={(e) => setExitFee(e.target.value)}
                      className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3 text-xs text-slate-600">
                <div>Risk/share: {Number.isFinite(riskPerShare) ? riskPerShare.toFixed(2) : "—"}</div>
                <div>Risk budget: {Number.isFinite(riskBudget) ? riskBudget.toFixed(2) : "—"}</div>
                <div>Shares by risk: {sharesByRisk}</div>
                <div>Shares by cash: {sharesByCash}</div>
                {sharesByPortfolioCap != null ? <div>Shares by portfolio cap: {sharesByPortfolioCap}</div> : null}
                <div>Risk used: {Number.isFinite(riskUsed) ? riskUsed.toFixed(2) : "—"}</div>
                <div>Position cost: {Number.isFinite(positionCost) ? positionCost.toFixed(2) : "—"}</div>
                <div>Total cost (incl. fees): {Number.isFinite(totalCostWithFees) ? totalCostWithFees.toFixed(2) : "—"}</div>
              </div>

              <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                <div className="mb-2 text-sm font-semibold tracking-tight text-slate-800">Targets</div>
                <div className="mb-3">
                  <label className="block text-xs text-slate-500">TP Plan</label>
                  <select
                    value={tpPlan}
                    onChange={(e) => {
                      const nextPlan = e.target.value as "tp1_only" | "tp1_tp2" | "none";
                      const anchor = Number(selected.entry ?? 0);
                      const defaultTp1 = modelTp1Pct > 0 ? modelTp1Pct : strategy === "v1_trend_hold" ? 10 : 5;
                      const defaultTp2 = modelTp2Pct > 0 ? modelTp2Pct : strategy === "v1_trend_hold" ? 20 : 10;
                      setTpPlan(nextPlan);
                      if (nextPlan === "none") {
                        setTp1Pct("");
                        setTp1Price("");
                        setTp2Pct("");
                        setTp2Price("");
                        setTp1SizePct("");
                        setTp2SizePct("");
                        return;
                      }
                      setTp1Pct(String(round1(defaultTp1)));
                      setTp1Price(Number.isFinite(anchor) && anchor > 0 ? round2(anchor * (1 + defaultTp1 / 100)).toFixed(2) : "");
                      if (nextPlan === "tp1_only") {
                        setTp1SizePct("100");
                        setTp2Pct("");
                        setTp2Price("");
                        setTp2SizePct("0");
                      } else {
                        setTp2Pct(String(round1(defaultTp2)));
                        setTp2Price(Number.isFinite(anchor) && anchor > 0 ? round2(anchor * (1 + defaultTp2 / 100)).toFixed(2) : "");
                        setTp1SizePct("50");
                        setTp2SizePct("50");
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2 text-sm"
                  >
                    <option value="tp1_only">TP1 only</option>
                    <option value="tp1_tp2">TP1 + TP2</option>
                    <option value="none">No TP</option>
                  </select>
                </div>

                <div className="mb-3 text-xs text-slate-500">Based on entry: {selected.entry.toFixed(2)}</div>

                <div className="grid grid-cols-2 gap-3">
                  <div
                    className={`rounded-xl border p-3 ${
                      tpPlan === "none"
                        ? "border-slate-200 bg-slate-50 text-slate-400"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wide">TP1</div>
                    <div className="mt-1 text-lg font-semibold">{tp1Price || selected.tp1.toFixed(2)}</div>
                    <div className="text-xs">+{tp1Pct || modelTp1Pct.toFixed(1)}%</div>
                  </div>
                  <div
                    className={`rounded-xl border p-3 ${
                      tpPlan === "tp1_tp2"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-slate-200 bg-slate-50 text-slate-400"
                    }`}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wide">TP2</div>
                    <div className="mt-1 text-lg font-semibold">{tp2Price || selected.tp2.toFixed(2)}</div>
                    <div className="text-xs">+{tp2Pct || modelTp2Pct.toFixed(1)}%</div>
                  </div>
                </div>
                {tpPlan !== "none" ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-slate-500">TP1 %</label>
                      <input
                        value={tp1Pct}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTp1Pct(v);
                          const n = Number(v);
                          const anchor = Number(selected.entry ?? 0);
                          if (Number.isFinite(n) && n > 0 && Number.isFinite(anchor) && anchor > 0) {
                            setTp1Price(round2(anchor * (1 + n / 100)).toFixed(2));
                          }
                        }}
                        className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                        inputMode="decimal"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500">TP1 price</label>
                      <input
                        value={tp1Price}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTp1Price(v);
                          const p = Number(v);
                          const anchor = Number(selected.entry ?? 0);
                          if (Number.isFinite(p) && p > 0 && Number.isFinite(anchor) && anchor > 0) {
                            setTp1Pct(String(round1(((p / anchor) - 1) * 100)));
                          }
                        }}
                        className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                        inputMode="decimal"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500">TP1 size %</label>
                      <input
                        value={tp1SizePct}
                        onChange={(e) => setTp1SizePct(e.target.value)}
                        className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                ) : null}
                {tpPlan === "tp1_tp2" ? (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-slate-500">TP2 %</label>
                      <input
                        value={tp2Pct}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTp2Pct(v);
                          const n = Number(v);
                          const anchor = Number(selected.entry ?? 0);
                          if (Number.isFinite(n) && n > 0 && Number.isFinite(anchor) && anchor > 0) {
                            setTp2Price(round2(anchor * (1 + n / 100)).toFixed(2));
                          }
                        }}
                        className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                        inputMode="decimal"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500">TP2 price</label>
                      <input
                        value={tp2Price}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTp2Price(v);
                          const p = Number(v);
                          const anchor = Number(selected.entry ?? 0);
                          if (Number.isFinite(p) && p > 0 && Number.isFinite(anchor) && anchor > 0) {
                            setTp2Pct(String(round1(((p / anchor) - 1) * 100)));
                          }
                        }}
                        className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                        inputMode="decimal"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500">TP2 size %</label>
                      <input
                        value={tp2SizePct}
                        onChange={(e) => setTp2SizePct(e.target.value)}
                        className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                ) : null}
                {tpPlan === "none" ? (
                  <div className="mt-2 text-xs text-slate-500">No TP will be saved for this position.</div>
                ) : null}
              </div>

              <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                <button
                  onClick={openDetails}
                  className="text-xs text-slate-600 underline"
                  disabled={detailsLoading}
                >
                  {detailsLoading ? "Loading details…" : "Load details / explainability"}
                </button>
                {details ? (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-2 text-[11px] text-slate-100">
{JSON.stringify(details, null, 2)}
                  </pre>
                ) : null}
              </div>
              {error ? <div className="text-sm text-rose-600">{error}</div> : null}
            </div>
            <div className="border-t border-[#e3d2b6] p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={openPaperPosition}
                  disabled={paperSaving}
                  className="w-full rounded-xl border border-[#dcc9aa] bg-[#f3e7d3] px-4 py-2 text-sm font-medium text-slate-900 hover:bg-[#eadcbf] disabled:opacity-50"
                >
                  {paperSaving ? "Opening..." : "Open Paper Position"}
                </button>
                <button
                  onClick={addPosition}
                  disabled={saving}
                  className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? "Adding..." : "Add Position"}
                </button>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Paper execution is simulated only and kept separate from broker positions.
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
