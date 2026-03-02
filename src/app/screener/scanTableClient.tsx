"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";

type Row = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  entry: number;
  stop: number;
  tp1?: number | null;
  tp2?: number | null;
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
  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-start justify-center p-4 pt-10">
        <div className="relative z-[10000] w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <div className="text-base font-semibold text-slate-900">{title}</div>
              {subtitle ? <div className="mt-1 text-xs text-slate-500">{subtitle}</div> : null}
            </div>
            <button
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-50"
              onClick={onClose}
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

async function fetchJsonOrText(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const json = await res.json().catch(() => null);
    return { json, text: null };
  }
  const text = await res.text().catch(() => "");
  return { json: null, text };
}

export default function ScanTableClient({
  rows,
  scanDate,
  accountSize = null,
  riskPerTrade = null,
  capitalDeployed = 0,
}: {
  rows: Row[];
  scanDate: string;
  accountSize?: number | null;
  riskPerTrade?: number | null;
  capitalDeployed?: number;
}) {
  const [filter, setFilter] = useState<"BUY+WATCH" | "BUY" | "WATCH" | "AVOID" | "ALL">("BUY"); // default tighter
  const [quotes, setQuotes] = useState<Record<string, number | null>>({});
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  // cache suggested shares from Calc so Open can work (shares is required by your API)
  const [sharesBySymbol, setSharesBySymbol] = useState<Record<string, number>>({});

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>(undefined);
  const [modalJson, setModalJson] = useState<any>(null);
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

  // If BUY has 0 rows, fallback to BUY+WATCH; if still 0, fallback to ALL
  useEffect(() => {
    if (filter === "BUY" && counts.buy === 0 && counts.buyWatch > 0) setFilter("BUY+WATCH");
    if ((filter === "BUY" || filter === "BUY+WATCH") && counts.buyWatch === 0 && counts.total > 0) setFilter("ALL");
  }, [filter, counts.buy, counts.buyWatch, counts.total]);

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

  function openModal(title: string, payload: any, subtitle?: string) {
    setModalTitle(title);
    setModalSubtitle(subtitle);
    setModalJson(payload);
    setModalOpen(true);
  }

  async function doCalc(row: Row) {
    setModalBusy(true);
    showToast(`Calc: ${row.symbol}`);

    const maxRiskUsd =
      typeof accountSize === "number" && typeof riskPerTrade === "number"
        ? accountSize * riskPerTrade
        : null;

    const remainingCash =
      typeof accountSize === "number" ? Math.max(0, accountSize - (capitalDeployed ?? 0)) : null;

    const rPerShare = row.entry - row.stop;
    const riskShares =
      maxRiskUsd && rPerShare > 0 ? Math.floor(maxRiskUsd / rPerShare) : null;

    const cashShares =
      remainingCash && row.entry > 0 ? Math.floor(remainingCash / row.entry) : null;

    const suggested =
      riskShares !== null && cashShares !== null
        ? Math.min(riskShares, cashShares)
        : riskShares ?? cashShares;

    // cache for Open
    if (typeof suggested === "number" && suggested > 0) {
      setSharesBySymbol((prev) => ({ ...prev, [row.symbol.toUpperCase()]: suggested }));
    }

    openModal(
      `Position sizing: ${row.symbol}`,
      {
        ok: true,
        symbol: row.symbol,
        entry: row.entry,
        stop: row.stop,
        tp1: row.tp1 ?? null,
        tp2: row.tp2 ?? null,
        maxRiskUsd,
        remainingCash,
        riskShares,
        cashShares,
        suggestedShares: suggested,
        note:
          "Suggested shares are capped by BOTH risk-per-trade and remaining cash. (No broker orders placed.)",
      },
      "Uses your active portfolio risk settings."
    );

    setModalBusy(false);
  }

  async function doOpen(row: Row) {
    setModalBusy(true);
    showToast(`Open: ${row.symbol}`);

    const sym = row.symbol.toUpperCase();
    const shares = sharesBySymbol[sym] ?? null;

    if (!shares || shares <= 0) {
      openModal(
        `Open position: ${row.symbol}`,
        { ok: false, error: "Run Calc first so we know how many shares to open." }
      );
      setModalBusy(false);
      return;
    }

    try {
      // ✅ Match your API exactly: { symbol, entry_price, stop, shares }
      const res = await fetch("/api/positions/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: sym,
          entry_price: row.entry,
          stop: row.stop,
          shares,
        }),
      });

      const parsed = await fetchJsonOrText(res);
      const json = parsed.json ?? { ok: false, error: parsed.text || `HTTP ${res.status}` };

      openModal(`Open position: ${row.symbol}`, json);
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
      // ✅ Match your API: GET /api/why?symbol=&date=&universe=&version=
      const params = new URLSearchParams({
        symbol: row.symbol.toUpperCase(),
        date: scanDate,
        universe: "liquid_2000",
        version: "v1",
      });

      const res = await fetch(`/api/why?${params.toString()}`, { method: "GET" });

      const parsed = await fetchJsonOrText(res);
      const json =
        parsed.json ??
        {
          ok: false,
          error: `Non-JSON response (HTTP ${res.status})`,
          raw: parsed.text?.slice(0, 1000) ?? "",
        };

      openModal(`Why: ${row.symbol}`, json);
    } catch (e: any) {
      openModal(`Why: ${row.symbol}`, { ok: false, error: e?.message ?? "Failed" });
    } finally {
      setModalBusy(false);
    }
  }

  function renderModalBody() {
    const j = modalJson ?? {};
    const ok = !!j?.ok;

    if (!ok) {
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <div className="font-semibold">Action failed</div>
            <div className="mt-1">{String(j?.error ?? "Unknown error")}</div>
          </div>

          {j?.raw ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-900">Raw response</div>
              <pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{String(j.raw)}
              </pre>
            </div>
          ) : null}
        </div>
      );
    }

    // Why route returns { ok: true, row: {...} }
    if (j?.row) {
      const row = j.row;
      const summary = row?.reason_summary ?? null;
      const checks = row?.reason_json?.checks ?? null;

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

    // Calc modal
    if (j?.suggestedShares !== undefined) {
      return (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <KV k="Suggested shares (final)" v={String(j.suggestedShares ?? "—")} />
            <KV k="Max risk (USD)" v={j.maxRiskUsd !== null ? fmtMoney(Number(j.maxRiskUsd)) : "—"} />
            <KV k="Remaining cash" v={j.remainingCash !== null ? fmtMoney(Number(j.remainingCash)) : "—"} />
            <KV k="Risk-based shares" v={j.riskShares !== null ? String(j.riskShares) : "—"} />
            <KV k="Cash-capped shares" v={j.cashShares !== null ? String(j.cashShares) : "—"} />
            <KV k="Entry" v={fmt2(Number(j.entry))} />
            <KV k="Stop" v={fmt2(Number(j.stop))} />
            <KV k="TP1" v={j.tp1 ? fmt2(Number(j.tp1)) : "—"} />
            <KV k="TP2" v={j.tp2 ? fmt2(Number(j.tp2)) : "—"} />
          </div>

          <div className="text-xs text-slate-500">{String(j.note ?? "")}</div>
        </div>
      );
    }

    // Open success (your route returns { ok:true, id })
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <div className="font-semibold">Success</div>
          <div className="mt-1">Position created.</div>
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
        <button className={chipClass(filter === "BUY+WATCH")} onClick={() => setFilter("BUY+WATCH")}>BUY + WATCH</button>
        <button className={chipClass(filter === "BUY")} onClick={() => setFilter("BUY")}>BUY</button>
        <button className={chipClass(filter === "WATCH")} onClick={() => setFilter("WATCH")}>WATCH</button>
        <button className={chipClass(filter === "AVOID")} onClick={() => setFilter("AVOID")}>AVOID</button>
        <button className={chipClass(filter === "ALL")} onClick={() => setFilter("ALL")}>ALL</button>
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
            {lastUpdatedAt ? <span className="ml-2 text-slate-400">Updated: {new Date(lastUpdatedAt).toLocaleTimeString()}</span> : null}
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
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="p-3">SYMBOL</th>
                <th className="p-3">SIGNAL</th>
                <th className="p-3">CONF</th>
                <th className="p-3">ENTRY</th>
                <th className="p-3">STOP</th>
                <th className="p-3">TP1</th>
                <th className="p-3">TP2</th>
                <th className="p-3">LIVE</th>
                <th className="p-3">Δ vs ENTRY</th>
                <th className="p-3 text-right">ACTIONS</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 ? (
                <tr><td className="p-3 text-slate-500" colSpan={10}>No rows for this filter.</td></tr>
              ) : (
                filtered.map((r) => {
                  const sym = r.symbol.trim().toUpperCase();
                  const live = quotes?.[sym] ?? null;

                  const entry = Number(r.entry);
                  const dEntry = typeof live === "number" && Number.isFinite(live) ? (live - entry) / entry : null;

                  const dEntryClass =
                    typeof dEntry === "number"
                      ? dEntry > 0 ? "text-emerald-600" : dEntry < 0 ? "text-rose-600" : "text-slate-600"
                      : "text-slate-500";

                  const cachedShares = sharesBySymbol[sym];

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
                      <td className="p-3 text-slate-800">{r.tp1 ? Number(r.tp1).toFixed(2) : "—"}</td>
                      <td className="p-3 text-slate-800">{r.tp2 ? Number(r.tp2).toFixed(2) : "—"}</td>

                      <td className="p-3 text-slate-800">{typeof live === "number" ? fmt2(live) : "—"}</td>
                      <td className={clsx("p-3 font-semibold", dEntryClass)}>{typeof dEntry === "number" ? fmtPct(dEntry) : "—"}</td>

                      <td className="p-3">
                        <div className="flex justify-end gap-2 whitespace-nowrap">
                          <Button variant="secondary" onClick={() => doCalc(r)} disabled={modalBusy}>Calc</Button>
                          <Button onClick={() => doOpen(r)} disabled={modalBusy}>
                            Open{cachedShares ? ` (${cachedShares})` : ""}
                          </Button>
                          <Button variant="secondary" onClick={() => doDetails(r)} disabled={modalBusy}>Details</Button>
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

      <Modal open={modalOpen} title={modalTitle} subtitle={modalSubtitle} onClose={() => setModalOpen(false)}>
        {renderModalBody()}
      </Modal>
    </div>
  );
}