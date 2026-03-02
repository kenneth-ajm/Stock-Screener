"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";

type Row = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  entry: number;
  stop: number;
};

function fmt2(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtPct(p: number | null | undefined) {
  if (typeof p !== "number" || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${(p * 100).toFixed(1)}%`;
}

function chipClass(active: boolean) {
  return [
    "rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide",
    active ? "border-slate-300 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
  ].join(" ");
}

function signalPill(signal: Row["signal"]) {
  if (signal === "BUY") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (signal === "WATCH") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

export default function ScanTableClient({ rows, scanDate }: { rows: Row[]; scanDate: string }) {
  const [filter, setFilter] = useState<"BUY+WATCH" | "BUY" | "WATCH" | "AVOID" | "ALL">("BUY+WATCH");

  // live quotes state
  const [quotes, setQuotes] = useState<Record<string, number | null>>({});
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const counts = useMemo(() => {
    const r = rows ?? [];
    return {
      total: r.length,
      buy: r.filter((x) => x.signal === "BUY").length,
      watch: r.filter((x) => x.signal === "WATCH").length,
      avoid: r.filter((x) => x.signal === "AVOID").length,
      buyWatch: r.filter((x) => x.signal === "BUY" || x.signal === "WATCH").length,
    };
  }, [rows]);

  // Auto-fallback: if BUY+WATCH has zero rows, show ALL instead so the page never looks empty
  useEffect(() => {
    if (filter === "BUY+WATCH" && counts.buyWatch === 0 && counts.total > 0) {
      setFilter("ALL");
    }
  }, [filter, counts.buyWatch, counts.total]);

  const filtered = useMemo(() => {
    const r = rows ?? [];
    if (filter === "ALL") return r;
    if (filter === "BUY+WATCH") return r.filter((x) => x.signal === "BUY" || x.signal === "WATCH");
    return r.filter((x) => x.signal === filter);
  }, [rows, filter]);

  const countsShown = useMemo(() => {
    const r = rows ?? [];
    return {
      showing: filtered.length,
      buy: r.filter((x) => x.signal === "BUY").length,
      watch: r.filter((x) => x.signal === "WATCH").length,
      avoid: r.filter((x) => x.signal === "AVOID").length,
    };
  }, [rows, filtered]);

  const symbolsToQuote = useMemo(() => {
    const syms = filtered.map((r) => (r.symbol ?? "").trim().toUpperCase()).filter(Boolean);
    return Array.from(new Set(syms)).slice(0, 50);
  }, [filtered]);

  async function refreshQuotes() {
    if (symbolsToQuote.length === 0) return;
    try {
      setQuoteBusy(true);
      setQuoteError(null);

      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols: symbolsToQuote }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Quote fetch failed.");
      }

      setQuotes((prev) => ({ ...prev, ...(json.quotes ?? {}) }));
      setLastUpdatedAt(Date.now());
    } catch (e: any) {
      setQuoteError(e?.message ?? "Quote fetch failed.");
    } finally {
      setQuoteBusy(false);
    }
  }

  // refresh quotes when filter changes
  useEffect(() => {
    refreshQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // auto refresh every 15s
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      refreshQuotes();
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, symbolsToQuote.join("|")]);

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        <button className={chipClass(filter === "BUY+WATCH")} onClick={() => setFilter("BUY+WATCH")}>
          BUY + WATCH
        </button>
        <button className={chipClass(filter === "BUY")} onClick={() => setFilter("BUY")}>
          BUY
        </button>
        <button className={chipClass(filter === "WATCH")} onClick={() => setFilter("WATCH")}>
          WATCH
        </button>
        <button className={chipClass(filter === "AVOID")} onClick={() => setFilter("AVOID")}>
          AVOID
        </button>
        <button className={chipClass(filter === "ALL")} onClick={() => setFilter("ALL")}>
          ALL
        </button>
      </div>

      <div className="text-sm muted">
        Confidence is a 0–100 score from trend alignment (SMA), RSI, volume confirmation, and extension penalties (regime may downgrade).
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">SHOWING</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{countsShown.showing}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">BUY</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{countsShown.buy}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">WATCH</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{countsShown.watch}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">AVOID</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{countsShown.avoid}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            Live prices overlay (signals remain daily). <span className="text-slate-400">Scan date: {scanDate}</span>
            {lastUpdatedAt ? (
              <span className="ml-2 text-slate-400">Updated: {new Date(lastUpdatedAt).toLocaleTimeString()}</span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${
                auto ? "border-slate-300 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
              }`}
              onClick={() => setAuto((v) => !v)}
              disabled={quoteBusy}
              title="Auto-refresh live prices every 15 seconds"
            >
              Auto
            </button>

            <Button variant="secondary" onClick={refreshQuotes} disabled={quoteBusy || symbolsToQuote.length === 0}>
              {quoteBusy ? "Refreshing..." : "Refresh prices"}
            </Button>
          </div>
        </div>

        {quoteError ? <div className="px-3 py-2 text-xs text-rose-600 border-b border-slate-200">{quoteError}</div> : null}

        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="p-3">SYMBOL</th>
                <th className="p-3">SIGNAL</th>
                <th className="p-3">CONF</th>
                <th className="p-3">ENTRY</th>
                <th className="p-3">STOP</th>
                <th className="p-3">LIVE</th>
                <th className="p-3">Δ vs ENTRY</th>
                <th className="p-3 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={8}>
                    No rows for this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const sym = r.symbol.trim().toUpperCase();
                  const live = quotes?.[sym] ?? null;

                  const entry = Number(r.entry);
                  const dEntry = typeof live === "number" && Number.isFinite(live) ? (live - entry) / entry : null;

                  const dEntryClass =
                    typeof dEntry === "number"
                      ? dEntry > 0
                        ? "text-emerald-600"
                        : dEntry < 0
                          ? "text-rose-600"
                          : "text-slate-600"
                      : "text-slate-500";

                  return (
                    <tr key={r.symbol} className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-900">{r.symbol}</td>
                      <td className="p-3">
                        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${signalPill(r.signal)}`}>
                          {r.signal}
                        </span>
                      </td>
                      <td className="p-3 text-slate-800">{r.confidence}</td>
                      <td className="p-3 text-slate-800">{Number(r.entry).toFixed(2)}</td>
                      <td className="p-3 text-slate-800">{Number(r.stop).toFixed(2)}</td>

                      <td className="p-3 text-slate-800">{typeof live === "number" ? fmt2(live) : "—"}</td>
                      <td className={`p-3 font-semibold ${dEntryClass}`}>{typeof dEntry === "number" ? fmtPct(dEntry) : "—"}</td>

                      <td className="p-3">
                        <div className="flex justify-end gap-2 whitespace-nowrap">
                          <Button variant="secondary">Calc</Button>
                          <Button>Open</Button>
                          <Button variant="secondary">Details</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 text-xs text-slate-500">
          Tip: On mobile, swipe sideways to see all columns. Live data may be delayed depending on your Polygon plan.
        </div>
      </div>
    </div>
  );
}