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

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Toast({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-[10001]">
      <div className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl">
        {msg}
      </div>
    </div>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative z-[10000] w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="text-base font-semibold text-slate-900">{title}</div>
            <button
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-50"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function ScanTableClient({ rows, scanDate }: { rows: Row[]; scanDate: string }) {
  const [filter, setFilter] = useState<"BUY+WATCH" | "BUY" | "WATCH" | "AVOID" | "ALL">("BUY+WATCH");

  // live quotes state
  const [quotes, setQuotes] = useState<Record<string, number | null>>({});
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  // action modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalJson, setModalJson] = useState<any>(null);
  const [modalBusy, setModalBusy] = useState(false);

  // toast fallback (so you always get feedback)
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1400);
  }

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
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Quote fetch failed.");

      setQuotes((prev) => ({ ...prev, ...(json.quotes ?? {}) }));
      setLastUpdatedAt(Date.now());
    } catch (e: any) {
      setQuoteError(e?.message ?? "Quote fetch failed.");
    } finally {
      setQuoteBusy(false);
    }
  }

  useEffect(() => {
    refreshQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => refreshQuotes(), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, symbolsToQuote.join("|")]);

  function openModal(title: string, payload: any) {
    setModalTitle(title);
    setModalJson(payload);
    setModalOpen(true);
  }

  async function doCalc(row: Row) {
    setModalBusy(true);
    showToast(`Calc: ${row.symbol}`);
    try {
      const res = await fetch("/api/position-size", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: row.symbol,
          entry: row.entry,
          stop: row.stop,
        }),
      });
      const json = await res.json().catch(() => null);
      openModal(`Calc position size: ${row.symbol}`, json ?? { ok: false, error: "No response" });
    } catch (e: any) {
      openModal(`Calc position size: ${row.symbol}`, { ok: false, error: e?.message ?? "Failed" });
    } finally {
      setModalBusy(false);
    }
  }

  async function doOpen(row: Row) {
    setModalBusy(true);
    showToast(`Open: ${row.symbol}`);
    try {
      const res = await fetch("/api/positions/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: row.symbol,
          entry_price: row.entry,
          stop_price: row.stop,
        }),
      });
      const json = await res.json().catch(() => null);
      openModal(`Open position: ${row.symbol}`, json ?? { ok: false, error: "No response" });
    } catch (e: any) {
      openModal(`Open position: ${row.symbol}`, { ok: false, error: e?.message ?? "Failed" });
    } finally {
      setModalBusy(false);
    }
  }

  async function doDetails(row: Row) {
    setModalBusy(true);
    showToast(`Details: ${row.symbol}`);
    try {
      const res = await fetch("/api/why", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: row.symbol,
          date: scanDate,
          universe_slug: "liquid_2000",
          strategy_version: "v1",
        }),
      });
      const json = await res.json().catch(() => null);
      openModal(`Why: ${row.symbol}`, json ?? { ok: false, error: "No response" });
    } catch (e: any) {
      openModal(`Why: ${row.symbol}`, { ok: false, error: e?.message ?? "Failed" });
    } finally {
      setModalBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {toast ? <Toast msg={toast} /> : null}

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
                      <td className="p-3 text-slate-800 font-semibold">{r.confidence}</td>
                      <td className="p-3 text-slate-800">{Number(r.entry).toFixed(2)}</td>
                      <td className="p-3 text-slate-800">{Number(r.stop).toFixed(2)}</td>

                      <td className="p-3 text-slate-800">{typeof live === "number" ? fmt2(live) : "—"}</td>
                      <td className={clsx("p-3 font-semibold", dEntryClass)}>{typeof dEntry === "number" ? fmtPct(dEntry) : "—"}</td>

                      <td className="p-3">
                        <div className="flex justify-end gap-2 whitespace-nowrap">
                          <Button variant="secondary" onClick={() => doCalc(r)} disabled={modalBusy}>
                            Calc
                          </Button>
                          <Button onClick={() => doOpen(r)} disabled={modalBusy}>
                            Open
                          </Button>
                          <Button variant="secondary" onClick={() => doDetails(r)} disabled={modalBusy}>
                            Details
                          </Button>
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

      <Modal open={modalOpen} title={modalTitle} onClose={() => setModalOpen(false)}>
        <pre className="max-h-[420px] overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(modalJson, null, 2)}
        </pre>
      </Modal>
    </div>
  );
}