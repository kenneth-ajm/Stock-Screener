"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { applyEarningsRiskToAction, type EarningsRisk } from "@/lib/earnings_risk";
import { applyBreadthToAction, type BreadthState } from "@/lib/market_breadth";
import { getBuyZone, getEntryStatus } from "@/lib/buy_zone";
import { mapExecutionState } from "@/lib/execution_state";

type ScorePayload = {
  ok: boolean;
  symbol?: string;
  signal?: "BUY" | "WATCH" | "AVOID";
  confidence?: number;
  entry?: number;
  stop?: number;
  tp1?: number;
  tp2?: number;
  reason_summary?: string;
  reason_json?: any;
  error?: string;
};

type QuotePayload = {
  ok: boolean;
  quotes?: Record<string, { price: number; asOf: string; source: "snapshot" | "eod_close" } | null>;
};

type EarningsPayload = {
  ok: boolean;
  earnings?: Record<string, EarningsRisk>;
};

function fmtPrice(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtPct(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function actionPill(action: "BUY NOW" | "WAIT" | "SKIP") {
  if (action === "BUY NOW") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (action === "WAIT") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function displayActionPill(action: "BUY NOW" | "WAIT" | "SKIP" | "MONITOR" | "DO NOT TRADE") {
  if (action === "BUY NOW") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (action === "WAIT" || action === "MONITOR") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function signalPill(signal: "BUY" | "WATCH" | "AVOID" | null) {
  if (signal === "BUY") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (signal === "WATCH") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-rose-300 bg-rose-50 text-rose-700";
}

const PRICE_MISMATCH_PCT = 0.2;

export default function TickerCheckClient(props: {
  breadthState: BreadthState;
  breadthLabel: string;
}) {
  const [symbolInput, setSymbolInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<ScorePayload | null>(null);
  const [quote, setQuote] = useState<{ price: number; asOf: string; source: "snapshot" | "eod_close" } | null>(null);
  const [earnings, setEarnings] = useState<EarningsRisk | null>(null);

  const symbol = useMemo(() => String(score?.symbol ?? "").trim().toUpperCase(), [score?.symbol]);
  const entry = typeof score?.entry === "number" ? score.entry : null;
  const live = typeof quote?.price === "number" ? quote.price : null;
  const delta = live != null && entry != null && entry > 0 ? ((live - entry) / entry) * 100 : null;
  const mismatch = live != null && entry != null && entry > 0 ? Math.abs((live - entry) / entry) > PRICE_MISMATCH_PCT : false;
  const status =
    mismatch
      ? "Price mismatch"
      : live != null && entry != null && entry > 0
        ? getEntryStatus({
            price: live,
            zone_low: getBuyZone({ strategy_version: "v2_core_momentum", model_entry: entry }).zone_low,
            zone_high: getBuyZone({ strategy_version: "v2_core_momentum", model_entry: entry }).zone_high,
          })
        : "No live price";
  const base = mapExecutionState(status);
  const withEarnings = applyEarningsRiskToAction(base, earnings);
  const finalAction = applyBreadthToAction(withEarnings, {
    breadthState: props.breadthState,
    breadthLabel: props.breadthLabel,
  });
  const signal = score?.signal ?? null;
  const isBuySignal = signal === "BUY";
  const displayAction: "BUY NOW" | "WAIT" | "SKIP" | "MONITOR" | "DO NOT TRADE" = isBuySignal
    ? finalAction.action
    : signal === "WATCH"
      ? "MONITOR"
      : "DO NOT TRADE";
  const displayReason = isBuySignal
    ? finalAction.reasonLabel
    : signal === "WATCH"
      ? "Strategy signal is WATCH — monitor only"
      : "Strategy signal is AVOID — do not trade";
  const rankValue = Number(score?.reason_json?.rank_score);

  async function runCheck() {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    setBusy(true);
    setError(null);
    setScore(null);
    setQuote(null);
    setEarnings(null);
    try {
      const scoreRes = await fetch("/api/score-symbol", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const scoreJson = (await scoreRes.json().catch(() => null)) as ScorePayload | null;
      if (!scoreRes.ok || !scoreJson?.ok) {
        throw new Error(scoreJson?.error ?? "Ticker check failed");
      }
      setScore(scoreJson);

      const [quoteRes, earningsRes] = await Promise.all([
        fetch("/api/quotes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbols: [symbol] }),
        }),
        fetch("/api/earnings-risk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbols: [symbol] }),
        }),
      ]);

      const quoteJson = (await quoteRes.json().catch(() => null)) as QuotePayload | null;
      const earningsJson = (await earningsRes.json().catch(() => null)) as EarningsPayload | null;
      setQuote((quoteJson?.quotes?.[symbol] as any) ?? null);
      setEarnings((earningsJson?.earnings?.[symbol] as EarningsRisk) ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Ticker check failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[#dfcfb2] bg-[#fff7ec] p-5 shadow-[0_6px_18px_rgba(88,63,36,0.05)]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">Manual Ticker Check</h2>
          <p className="mt-1 text-xs text-slate-600">Quick check for actionability now, then open normal Ideas flow.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runCheck();
            }}
            placeholder="Ticker (e.g. TSLA)"
            className="w-[180px] rounded-xl border border-[#e6d8c1] bg-[#fffdf8] px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#d4c1a2]"
          />
          <button
            onClick={runCheck}
            disabled={busy}
            className="rounded-xl border border-[#d8c8aa] bg-[#f1e4cd] px-3 py-2 text-sm font-medium text-slate-800 hover:bg-[#ecdcbf] disabled:opacity-60"
          >
            {busy ? "Checking..." : "Check"}
          </button>
        </div>
      </div>

      {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {score?.ok ? (
        <div className="mt-4 rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xl font-semibold text-slate-900">{symbol}</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${signalPill(score.signal ?? null)}`}>
                {score.signal ?? "—"}
              </span>
              <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${displayActionPill(displayAction)}`}>
                {displayAction}
              </span>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg border border-[#e6d8c1] bg-[#fffaf2] px-2.5 py-1.5"><span className="text-slate-500">Entry</span><div className="font-semibold text-slate-900">{fmtPrice(entry)}</div></div>
            <div className="rounded-lg border border-[#e6d8c1] bg-[#fffaf2] px-2.5 py-1.5">
              <span className="text-slate-500">Live / Last</span>
              <div className="font-semibold text-slate-900">{fmtPrice(live)}</div>
            </div>
            <div className="rounded-lg border border-[#e6d8c1] bg-[#fffaf2] px-2.5 py-1.5"><span className="text-slate-500">Delta</span><div className="font-semibold text-slate-900">{fmtPct(delta)}</div></div>
            <div className="rounded-lg border border-[#e6d8c1] bg-[#fffaf2] px-2.5 py-1.5"><span className="text-slate-500">Confidence / Rank</span><div className="font-semibold text-slate-900">{typeof score.confidence === "number" ? score.confidence.toFixed(0) : "—"} / {Number.isFinite(rankValue) ? rankValue.toFixed(1) : "—"}</div></div>
            <div className="rounded-lg border border-[#e6d8c1] bg-[#fffaf2] px-2.5 py-1.5"><span className="text-slate-500">Stop</span><div className="font-semibold text-slate-900">{fmtPrice(score.stop)}</div></div>
            <div className="rounded-lg border border-[#e6d8c1] bg-[#fffaf2] px-2.5 py-1.5"><span className="text-slate-500">TP1</span><div className="font-semibold text-slate-900">{fmtPrice(score.tp1)}</div></div>
            <div className="rounded-lg border border-[#e6d8c1] bg-[#fffaf2] px-2.5 py-1.5"><span className="text-slate-500">TP2</span><div className="font-semibold text-slate-900">{fmtPrice(score.tp2)}</div></div>
            <div className="rounded-lg border border-[#e6d8c1] bg-[#fffaf2] px-2.5 py-1.5">
              <span className="text-slate-500">Price Source</span>
              <div className="font-semibold text-slate-900">{quote?.source === "snapshot" ? "LIVE" : quote?.source === "eod_close" ? "EOD" : "—"}</div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#e4d7c3] bg-[#fff8ee] px-2 py-0.5 text-xs text-slate-700">{displayReason}</span>
            {mismatch ? (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">PRICE MISMATCH</span>
            ) : null}
            {earnings?.earningsLabel ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{earnings.earningsLabel}</span>
            ) : null}
            {finalAction.breadthLabel ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{finalAction.breadthLabel}</span>
            ) : null}
          </div>

          {score.reason_summary ? <div className="mt-3 text-sm text-slate-700">{score.reason_summary}</div> : null}

          <div className="mt-4 flex items-center gap-2">
            <Link
              href={`/ideas?strategy=momentum&symbol=${encodeURIComponent(symbol)}`}
              className="rounded-xl border border-[#d8c8aa] bg-[#f1e4cd] px-3 py-2 text-xs font-medium text-slate-800 hover:bg-[#ecdcbf]"
            >
              Open in Ideas
            </Link>
            {isBuySignal ? (
              <Link
                href={`/ideas?strategy=momentum&symbol=${encodeURIComponent(symbol)}`}
                className="rounded-xl border border-[#e4d7c3] bg-[#fffaf2] px-3 py-2 text-xs font-medium text-slate-700 hover:bg-[#fff6ea]"
              >
                Open Trade Ticket
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
