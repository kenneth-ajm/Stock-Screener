"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getBuyZone, getEntryStatus } from "@/lib/buy_zone";
import { mapExecutionState } from "@/lib/execution_state";
import { applyEarningsRiskToAction, type EarningsRisk } from "@/lib/earnings_risk";
import { applyBreadthToAction } from "@/lib/market_breadth";
import { defaultUniverseForStrategy } from "@/lib/strategy_universe";

type StrategyVersion = "v1" | "v1_sector_momentum" | "v1_trend_hold";
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
    regime_state: string | null;
    breadth_state?: "STRONG" | "MIXED" | "WEAK" | null;
    breadth_label?: string | null;
    pct_above_sma50?: number | null;
    pct_above_sma200?: number | null;
  };
  capacity?: {
    cash_available: number;
    cash_source: "manual" | "estimated";
    slots_left: number;
  } | null;
  rows?: IdeaRow[];
  error?: string;
};

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
  const tradeTicketRef = useRef<HTMLDivElement | null>(null);
  const entryInputRef = useRef<HTMLInputElement | null>(null);
  const breadth = {
    breadthState: data?.meta?.breadth_state ?? "STRONG",
    breadthLabel: data?.meta?.breadth_label ?? "Breadth strong",
  } as const;

  useEffect(() => {
    setStrategy(initialStrategy);
  }, [initialStrategy]);

  useEffect(() => {
    setUniverseMode(initialUniverse);
  }, [initialUniverse]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const qs = new URLSearchParams({ strategy_version: strategy });
    if (universeMode !== "auto") qs.set("universe_slug", universeMode);
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
          return;
        }
        setLastLoadOk(Boolean(json?.ok));
        setData(json);
      })
      .catch((e) => {
        if (!mounted) return;
        setLastLoadOk(false);
        setData({ ok: false, error: e instanceof Error ? e.message : "Load failed" });
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [strategy, universeMode]);

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
  const rows = useMemo(() => allRows.slice(0, 10), [allRows]);
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
    if (strategy === "v1_sector_momentum" && selected.reason_json) {
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

  function signalPill(signal: "BUY" | "WATCH" | "AVOID") {
    if (signal === "BUY") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (signal === "WATCH") return "border-amber-200 bg-amber-50 text-amber-700";
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  function actionPill(action: "BUY NOW" | "WAIT" | "SKIP") {
    if (action === "BUY NOW") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (action === "WAIT") return "border-amber-200 bg-amber-50 text-amber-700";
    return "border-rose-200 bg-rose-50 text-rose-700";
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
        </div>
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
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="surface-chip px-2.5 py-1">Regime: {data?.meta?.regime_state ?? "—"}</span>
          <span className="surface-chip px-2.5 py-1">Latest scan: {data?.meta?.date_used ?? "—"}</span>
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
        </div>
      </div>
      <div className="mt-[-8px] text-[11px] text-slate-500">
        Auto selects the latest populated universe for each strategy. Unavailable explicit universes are marked as not scanned yet.
      </div>

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
          {" • "}ok={loading ? "loading" : lastLoadOk === null ? "unknown" : lastLoadOk ? "true" : "false"}
          {" • "}api={lastApiUrl || "—"}
        </div>
      ) : null}

      <div className="surface-panel overflow-hidden">
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
                      {row.industry_group ? (
                        <div className="mt-0.5 text-[10px] font-normal text-slate-500">{row.industry_group}</div>
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
                  {strategy === "v1_trend_hold" ? "Trend Hold" : strategy === "v1_sector_momentum" ? "Sector Momentum" : "Momentum Swing"}
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
