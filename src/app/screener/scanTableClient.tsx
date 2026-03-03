"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";

export type Row = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  entry: number;
  stop: number;
  tp1?: number | null;
  tp2?: number | null;
};

function fmtMoney(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}
function fmtPct(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

type WhyRow = {
  symbol: string;
  date: string;
  universe_slug: string;
  reason_summary: string | null;
  reason_json: any;
  signal: string;
  confidence: number;
};

type Props = {
  // ✅ Accept either (so page.tsx can pass rows or initialRows)
  rows?: Row[];
  initialRows?: Row[];

  scanDate: string;

  universeSlug?: string; // default liquid_2000
  version?: string;

  accountSize?: number;
  riskPerTrade?: number;
  capitalDeployed?: number;
};

export default function ScanTableClient(props: Props) {
  const universeSlug = props.universeSlug ?? "liquid_2000";
  const version = props.version ?? "v1";

  const scanDate = props.scanDate;

  const accountSize =
    typeof props.accountSize === "number" && Number.isFinite(props.accountSize)
      ? props.accountSize
      : 20000;

  const riskPerTrade =
    typeof props.riskPerTrade === "number" && Number.isFinite(props.riskPerTrade)
      ? props.riskPerTrade
      : 0.01;

  const capitalDeployed =
    typeof props.capitalDeployed === "number" && Number.isFinite(props.capitalDeployed)
      ? props.capitalDeployed
      : 0;

  const remainingCash = Math.max(0, accountSize - capitalDeployed);

  // ✅ Bulletproof source of rows
  const baseRows: Row[] = (props.rows ?? props.initialRows ?? []) as Row[];

  // ✅ Default filter = BUY
  const [filter, setFilter] = useState<"BUY" | "WATCH" | "AVOID" | "ALL">("BUY");

  const [liveOn, setLiveOn] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, number | null>>({});

  const [calcShares, setCalcShares] = useState<Record<string, number>>({});
  const [busySymbol, setBusySymbol] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState<WhyRow | null>(null);

  const rows = useMemo(() => {
    if (filter === "ALL") return baseRows;
    return baseRows.filter((r) => r.signal === filter);
  }, [baseRows, filter]);

  const symbols = useMemo(() => rows.map((r) => r.symbol), [rows]);

  async function fetchQuotes() {
    if (!liveOn || symbols.length === 0) return;
    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbols }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) setQuotes(data.quotes || {});
  }

  useEffect(() => {
    fetchQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOn, symbols.join(",")]);

  useEffect(() => {
    if (!liveOn || !autoRefresh) return;
    const t = setInterval(() => fetchQuotes(), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOn, autoRefresh, symbols.join(",")]);

  function getDisplayedPrice(row: Row) {
    const q = quotes[row.symbol];
    if (liveOn && typeof q === "number" && Number.isFinite(q)) return q;
    return row.entry;
  }

  function computeShares(row: Row) {
    const entry = getDisplayedPrice(row);
    const stop = row.stop;

    const riskDollars = accountSize * riskPerTrade;
    const perShareRisk = Math.max(0, entry - stop);
    if (perShareRisk <= 0) return 0;

    const byRisk = Math.floor(riskDollars / perShareRisk);
    const byCash = Math.floor(remainingCash / Math.max(0.01, entry));
    return Math.max(0, Math.min(byRisk, byCash));
  }

  async function onCalc(row: Row) {
    const shares = computeShares(row);
    setCalcShares((prev) => ({ ...prev, [row.symbol]: shares }));
  }

  async function onOpen(row: Row) {
    const shares = calcShares[row.symbol];
    if (!shares || shares <= 0) {
      alert("Please Calc first (shares must be > 0).");
      return;
    }

    setBusySymbol(row.symbol);
    try {
      const entry_price = getDisplayedPrice(row);
      const res = await fetch("/api/positions/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: row.symbol,
          entry_price,
          stop: row.stop,
          shares,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      alert(`Opened ${row.symbol} (${shares} shares).`);
    } catch (e: any) {
      alert(e?.message || "Failed to open position");
    } finally {
      setBusySymbol(null);
    }
  }

  async function onDetails(row: Row) {
    setBusySymbol(row.symbol);
    try {
      const qs = new URLSearchParams({
        symbol: row.symbol,
        date: scanDate,
        universe: universeSlug,
        version,
      });
      const res = await fetch(`/api/why?${qs.toString()}`, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setDetails(data.row as WhyRow);
      setDetailsOpen(true);
    } catch (e: any) {
      alert(e?.message || "Failed to load details");
    } finally {
      setBusySymbol(null);
    }
  }

  return (
    <div className="rounded-2xl border bg-white/60 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">
            Universe: <span className="font-mono">{universeSlug}</span> • Date:{" "}
            <span className="font-mono">{scanDate}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Default filter is BUY. Global caps are enforced server-side across all batches.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="h-9 rounded-md border bg-white/70 px-2 text-sm"
          >
            <option value="BUY">BUY</option>
            <option value="WATCH">WATCH</option>
            <option value="AVOID">AVOID</option>
            <option value="ALL">ALL</option>
          </select>

          <Button onClick={() => setLiveOn((v) => !v)}>{liveOn ? "Live: ON" : "Live: OFF"}</Button>
          <Button disabled={!liveOn} onClick={() => setAutoRefresh((v) => !v)}>
            {autoRefresh ? "Auto: ON" : "Auto: OFF"}
          </Button>
          <Button disabled={!liveOn} onClick={() => fetchQuotes()}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        Account: {fmtMoney(accountSize)} • Risk/Trade: {fmtPct(riskPerTrade)} • Remaining cash:{" "}
        {fmtMoney(remainingCash)}
      </div>

      <div className="mt-4 overflow-auto rounded-xl border bg-white/40">
        <table className="w-full text-sm">
          <thead className="bg-white/60 text-xs">
            <tr className="text-left">
              <th className="p-3">Symbol</th>
              <th className="p-3">Signal</th>
              <th className="p-3">Conf</th>
              <th className="p-3">Entry</th>
              <th className="p-3">Stop</th>
              <th className="p-3">TP1</th>
              <th className="p-3">TP2</th>
              <th className="p-3">Shares</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-4 text-muted-foreground" colSpan={9}>
                  No rows for this filter yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const livePrice = quotes[r.symbol];
                const entryShown = liveOn && typeof livePrice === "number" ? livePrice : r.entry;

                return (
                  <tr key={r.symbol} className="border-t">
                    <td className="p-3 font-mono">{r.symbol}</td>
                    <td className="p-3">{r.signal}</td>
                    <td className="p-3">{r.confidence}</td>
                    <td className="p-3">{fmtMoney(entryShown)}</td>
                    <td className="p-3">{fmtMoney(r.stop)}</td>
                    <td className="p-3">{fmtMoney(r.tp1 ?? null)}</td>
                    <td className="p-3">{fmtMoney(r.tp2 ?? null)}</td>
                    <td className="p-3 font-mono">{calcShares[r.symbol] ?? "—"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => onCalc(r)} disabled={busySymbol === r.symbol}>
                          Calc
                        </Button>
                        <Button onClick={() => onOpen(r)} disabled={busySymbol === r.symbol}>
                          Open
                        </Button>
                        <Button onClick={() => onDetails(r)} disabled={busySymbol === r.symbol}>
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

      {detailsOpen && (
        <div className="mt-4 rounded-2xl border bg-white/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">
                {details?.symbol} • {details?.date} • {details?.signal} ({details?.confidence})
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {details?.reason_summary ?? "—"}
              </div>
            </div>
            <Button onClick={() => setDetailsOpen(false)}>Close</Button>
          </div>

          <div className="mt-3 rounded-xl border bg-white/60 p-3 text-xs">
            <div className="mb-2 font-semibold text-muted-foreground">reason_json</div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(details?.reason_json ?? null, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}