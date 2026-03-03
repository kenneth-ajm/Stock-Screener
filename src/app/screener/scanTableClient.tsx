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

function fmtMoney(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function fmtPct(p: number | null | undefined) {
  if (typeof p !== "number" || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${(p * 100).toFixed(1)}%`;
}

function chipClass(active: boolean) {
  return [
    "rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide",
    active
      ? "border-slate-300 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
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
  subtitle,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  // lock scroll behind modal
  // (simple approach)
  if (typeof document !== "undefined") document.body.style.overflow = "hidden";

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          if (typeof document !== "undefined") document.body.style.overflow = "";
          onClose();
        }}
        aria-hidden="true"
      />
      {/* pin near top so you don't "lose" it */}
      <div className="absolute inset-0 flex items-start justify-center p-4 pt-10">
        <div className="relative z-[10000] w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <div className="text-base font-semibold text-slate-900">{title}</div>
              {subtitle ? <div className="mt-1 text-xs text-slate-500">{subtitle}</div> : null}
            </div>
            <button
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-50"
              onClick={() => {
                if (typeof document !== "undefined") document.body.style.overflow = "";
                onClose();
              }}
            >
              Close
            </button>
          </div>

          <div className="p-4 max-h-[70vh] overflow-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs font-medium text-slate-500">{k}</div>
      <div className="text-sm font-semibold text-slate-900">{v}</div>
    </div>
  );
}

export default function ScanTableClient({ rows, scanDate }: { rows: Row[]; scanDate: string }) {
  const [filter, setFilter] = useState<"BUY+WATCH" | "BUY" | "WATCH" | "AVOID" | "ALL">("BUY+WATCH");

  const [quotes, setQuotes] = useState<Record<string, number | null>>({});
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>(undefined);
  const [modalJson, setModalJson] = useState<any>(null);
  const [modalKind, setModalKind] = useState<"CALC" | "OPEN" | "WHY" | "GENERIC">("GENERIC");
  const [modalBusy, setModalBusy] = useState(false);

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

  function openModal(kind: typeof modalKind, title: string, payload: any, subtitle?: string) {
    setModalKind(kind);
    setModalTitle(title);
    setModalSubtitle(subtitle);
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
      openModal("CALC", `Position sizing: ${row.symbol}`, json ?? { ok: false, error: "No response" }, "Uses your active portfolio risk settings.");
    } catch (e: any) {
      openModal("CALC", `Position sizing: ${row.symbol}`, { ok: false, error: e?.message ?? "Failed" });
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
      openModal("OPEN", `Open position: ${row.symbol}`, json ?? { ok: false, error: "No response" });
    } catch (e: any) {
      openModal("OPEN", `Open position: ${row.symbol}`, { ok: false, error: e?.message ?? "Failed" });
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
          universe_slug: "core_800",
          strategy_version: "v2_core_momentum",
        }),
      });
      const json = await res.json().catch(() => null);
      openModal("WHY", `Why: ${row.symbol}`, json ?? { ok: false, error: "No response" });
    } catch (e: any) {
      openModal("WHY", `Why: ${row.symbol}`, { ok: false, error: e?.message ?? "Failed" });
    } finally {
      setModalBusy(false);
    }
  }

  function renderModalBody() {
    const j = modalJson ?? {};
    const ok = !!j?.ok;
    const err = j?.error ?? j?.message ?? null;

    if (!ok) {
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <div className="font-semibold">Action failed</div>
            <div className="mt-1">{String(err ?? "Unknown error")}</div>
          </div>

          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Raw response</summary>
            <pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(j, null, 2)}
            </pre>
          </details>
        </div>
      );
    }

    if (modalKind === "CALC") {
      // best-effort display (we don't assume exact keys)
      const shares =
        j?.shares ?? j?.qty ?? j?.quantity ?? j?.size ?? j?.position_size ?? null;

      const riskUsd = j?.risk_usd ?? j?.riskUsd ?? j?.max_loss ?? null;
      const entry = j?.entry ?? j?.entry_price ?? null;
      const stop = j?.stop ?? j?.stop_price ?? null;

      return (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <KV k="Suggested shares" v={shares !== null ? String(shares) : "—"} />
            <KV k="Max risk (USD)" v={riskUsd !== null ? fmtMoney(Number(riskUsd)) : "—"} />
            <KV k="Entry" v={entry !== null ? fmt2(Number(entry)) : "—"} />
            <KV k="Stop" v={stop !== null ? fmt2(Number(stop)) : "—"} />
          </div>

          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Raw response</summary>
            <pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(j, null, 2)}
            </pre>
          </details>
        </div>
      );
    }

    if (modalKind === "WHY") {
      const summary = j?.reason_summary ?? j?.summary ?? null;
      const checks = j?.reason_json?.checks ?? j?.checks ?? null;

      return (
        <div className="space-y-3">
          {summary ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              <div className="text-xs text-slate-500">Summary</div>
              <div className="mt-1 font-semibold">{String(summary)}</div>
            </div>
          ) : null}

          {Array.isArray(checks) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-sm font-semibold text-slate-900">Checks</div>
              <div className="mt-2 space-y-2">
                {checks.slice(0, 12).map((c: any, idx: number) => (
                  <div key={idx} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-sm font-medium text-slate-900">{c?.label ?? "Check"}</div>
                    <div className={clsx("text-xs font-semibold", c?.ok ? "text-emerald-600" : "text-rose-600")}>
                      {c?.ok ? "PASS" : "FAIL"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Raw response</summary>
            <pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(j, null, 2)}
            </pre>
          </details>
        </div>
      );
    }

    // OPEN + generic
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <div className="font-semibold">Success</div>
          <div className="mt-1">Action completed.</div>
        </div>

        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Raw response</summary>
          <pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(j, null, 2)}
          </pre>
        </details>
      </div>
    );
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
        Confidence is a 0–100 score from strict momentum continuation checks: trend alignment, RSI band, volume confirmation, extension control, and regime gating.
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
                      <td className={clsx("p-3 font-semibold", dEntryClass)}>
                        {typeof dEntry === "number" ? fmtPct(dEntry) : "—"}
                      </td>

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

      <Modal
        open={modalOpen}
        title={modalTitle}
        subtitle={modalSubtitle}
        onClose={() => setModalOpen(false)}
      >
        {renderModalBody()}
      </Modal>
    </div>
  );
}
