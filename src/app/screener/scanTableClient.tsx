"use client";

import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Signal = "BUY" | "WATCH" | "AVOID";

type Row = {
  symbol: string;
  signal: Signal;
  confidence: number;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
};

type WhyData = {
  symbol: string;
  signal: Signal;
  confidence: number;
  reason_summary: string | null;
  reason_json: any;
};

type Plan = {
  symbol: string;
  signal: Signal;
  entry: number;
  stop: number;
  tp1: number | null;
  tp2: number | null;
  shares: number;
  riskAmount: number;
  positionValue: number;
  currency: string;
};

type Ticket = {
  symbol: string;
  signal: Signal;
  currency: string;
  plannedEntry: number;
  plannedStop: number;
  plannedShares: number;
  entryPrice: string;
  stop: string;
  shares: string;
};

type Filter = "BUY_WATCH" | "BUY" | "WATCH" | "AVOID" | "ALL";

function filterLabel(f: Filter) {
  if (f === "BUY_WATCH") return "BUY + WATCH";
  return f;
}

function variant(signal: Signal): "buy" | "watch" | "avoid" {
  if (signal === "BUY") return "buy";
  if (signal === "WATCH") return "watch";
  return "avoid";
}

function fmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "-";
  return Number(n).toFixed(2);
}

function money(value: number, currency = "USD") {
  if (!Number.isFinite(value)) return "-";
  return `${currency} ${value.toFixed(2)}`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wide muted">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

function CheckLine({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={[
          "mt-0.5 h-5 w-5 rounded-full flex items-center justify-center text-xs font-bold",
          ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800",
        ].join(" ")}
      >
        {ok ? "✓" : "×"}
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {detail ? <div className="text-sm muted">{detail}</div> : null}
      </div>
    </div>
  );
}

export default function ScanTableClient({
  rows,
  scanDate,
}: {
  rows: Row[];
  scanDate: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [filter, setFilter] = useState<Filter>("BUY_WATCH");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);

  const [why, setWhy] = useState<WhyData | null>(null);

  const filteredRows = useMemo(() => {
    const base =
      filter === "BUY"
        ? rows.filter((r) => r.signal === "BUY")
        : filter === "WATCH"
        ? rows.filter((r) => r.signal === "WATCH")
        : filter === "AVOID"
        ? rows.filter((r) => r.signal === "AVOID")
        : filter === "BUY_WATCH"
        ? rows.filter((r) => r.signal === "BUY" || r.signal === "WATCH")
        : rows;

    // BUY pinned to top, then confidence desc
    return [...base].sort((a, b) => {
      if (a.signal === "BUY" && b.signal !== "BUY") return -1;
      if (b.signal === "BUY" && a.signal !== "BUY") return 1;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
  }, [rows, filter]);

  const signalCounts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc[row.signal] += 1;
        return acc;
      },
      { BUY: 0, WATCH: 0, AVOID: 0 } as Record<Signal, number>
    );
  }, [rows]);

  async function loadWhy(symbol: string) {
    setMsg(null);
    setBusyKey(`why-${symbol}`);
    try {
      const res = await fetch(
        `/api/why?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(
          scanDate
        )}`
      );
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(`${symbol}: ${json?.error || `Failed (${res.status})`}`);
        return;
      }

      setWhy(json.row as WhyData);
    } catch {
      setMsg(`${symbol}: Failed to fetch explanation`);
    } finally {
      setBusyKey(null);
    }
  }

  async function calculatePlan(row: Row): Promise<Plan | null> {
    if (row.entry == null || row.stop == null) {
      setMsg(`${row.symbol}: Missing entry or stop.`);
      return null;
    }

    setMsg(null);
    setBusyKey(`size-${row.symbol}`);

    try {
      const res = await fetch("/api/position-size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry: row.entry, stop: row.stop }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(`${row.symbol}: ${json?.error || `Failed (${res.status})`}`);
        return null;
      }

      const nextPlan: Plan = {
        symbol: row.symbol,
        signal: row.signal,
        entry: row.entry,
        stop: row.stop,
        tp1: row.tp1 ?? null,
        tp2: row.tp2 ?? null,
        shares: Number(json.shares),
        riskAmount: Number(json.risk_amount),
        positionValue: Number(json.position_value),
        currency: String(json.account_currency ?? "USD"),
      };

      setPlan(nextPlan);
      return nextPlan;
    } catch {
      setMsg(`${row.symbol}: Failed to fetch sizing.`);
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  function openTicketFromPlan(nextPlan: Plan) {
    setTicket({
      symbol: nextPlan.symbol,
      signal: nextPlan.signal,
      currency: nextPlan.currency,
      plannedEntry: nextPlan.entry,
      plannedStop: nextPlan.stop,
      plannedShares: nextPlan.shares,
      entryPrice: nextPlan.entry.toFixed(2),
      stop: nextPlan.stop.toFixed(2),
      shares: String(nextPlan.shares),
    });
    setMsg(null);
  }

  async function handleOpen(row: Row) {
    const existingPlan =
      plan?.symbol === row.symbol ? plan : await calculatePlan(row);
    if (!existingPlan) return;
    openTicketFromPlan(existingPlan);
  }

  async function saveTicket() {
    if (!ticket) return;

    const entryPrice = Number(ticket.entryPrice);
    const stop = Number(ticket.stop);
    const shares = Number(ticket.shares);

    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      setMsg(`${ticket.symbol}: Enter a valid entry price.`);
      return;
    }
    if (!Number.isFinite(stop) || stop <= 0) {
      setMsg(`${ticket.symbol}: Enter a valid stop.`);
      return;
    }
    if (entryPrice <= stop) {
      setMsg(`${ticket.symbol}: Entry must be above stop.`);
      return;
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      setMsg(`${ticket.symbol}: Enter a valid share quantity.`);
      return;
    }

    setMsg(null);
    setBusyKey(`save-${ticket.symbol}`);

    try {
      const res = await fetch("/api/positions/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: ticket.symbol,
          entry_price: entryPrice,
          stop,
          shares,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(`${ticket.symbol}: ${json?.error || `Failed (${res.status})`}`);
        return;
      }

      setMsg(`${ticket.symbol}: Position saved to portfolio ✅`);
      setTicket(null);
    } catch {
      setMsg(`${ticket.symbol}: Failed to save position.`);
    } finally {
      setBusyKey(null);
    }
  }

  function toggleExpanded(symbol: string) {
    setExpanded((prev) => (prev === symbol ? null : symbol));
    setWhy(null); // clear previous Why, user can load again for the expanded row
  }

  const expandedRow = useMemo(
    () => filteredRows.find((r) => r.symbol === expanded) ?? null,
    [filteredRows, expanded]
  );

  const actualEntry = ticket ? Number(ticket.entryPrice) : NaN;
  const actualStop = ticket ? Number(ticket.stop) : NaN;
  const actualShares = ticket ? Number(ticket.shares) : NaN;

  const actualPositionValue =
    Number.isFinite(actualEntry) && Number.isFinite(actualShares)
      ? actualEntry * actualShares
      : NaN;

  const actualRisk =
    Number.isFinite(actualEntry) &&
    Number.isFinite(actualStop) &&
    Number.isFinite(actualShares)
      ? Math.max((actualEntry - actualStop) * actualShares, 0)
      : NaN;

  return (
    <div>
      {/* Filters + confidence explainer */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["BUY_WATCH", "BUY", "WATCH", "AVOID", "ALL"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={[
                "rounded-full px-3 py-1 text-sm border shadow-sm",
                filter === f
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white border-slate-200 hover:bg-slate-50",
              ].join(" ")}
            >
              {filterLabel(f)}
            </button>
          ))}
        </div>

        <div className="text-sm muted">
          <span className="font-semibold">Confidence</span> is a 0–100 score from trend
          alignment (SMA), RSI, volume confirmation, and extension penalties (regime may downgrade).
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Showing" value={`${filteredRows.length} rows`} />
        <StatCard label="Buy" value={String(signalCounts.BUY)} />
        <StatCard label="Watch" value={String(signalCounts.WATCH)} />
        <StatCard label="Avoid" value={String(signalCounts.AVOID)} />
      </div>

      {msg ? (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          {msg}
        </div>
      ) : null}

      {/* Recommended plan */}
      {plan ? (
        <div className="mb-4 rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm muted">Recommended trade plan</div>
              <div className="mt-1 flex items-center gap-3">
                <div className="text-2xl font-semibold">{plan.symbol}</div>
                <Badge variant={variant(plan.signal)}>{plan.signal}</Badge>
              </div>
              <div className="mt-2 text-sm muted">
                Suggested size based on your portfolio risk rules.
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => openTicketFromPlan(plan)}>
                Open position
              </Button>
              <Button variant="secondary" onClick={() => setPlan(null)}>
                Dismiss
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <StatCard label="Entry" value={plan.entry.toFixed(2)} />
            <StatCard label="Stop" value={plan.stop.toFixed(2)} />
            <StatCard label="TP1" value={plan.tp1 == null ? "-" : plan.tp1.toFixed(2)} />
            <StatCard label="TP2" value={plan.tp2 == null ? "-" : plan.tp2.toFixed(2)} />
            <StatCard label="Shares" value={String(plan.shares)} />
            <StatCard label="Capital" value={money(plan.positionValue, plan.currency)} />
          </div>

          <div className="mt-3 text-sm muted">
            Planned risk:{" "}
            <span className="font-semibold">
              {money(plan.riskAmount, plan.currency)}
            </span>
          </div>
        </div>
      ) : null}

      {/* Trade ticket */}
      {ticket ? (
        <div className="mb-4 rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm muted">Open position ticket</div>
              <div className="mt-1 flex items-center gap-3">
                <div className="text-2xl font-semibold">{ticket.symbol}</div>
                <Badge variant={variant(ticket.signal)}>{ticket.signal}</Badge>
              </div>
              <div className="mt-2 text-sm muted">
                Edit these fields to reflect your actual buy.
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={busyKey === `save-${ticket.symbol}`}
                onClick={saveTicket}
              >
                {busyKey === `save-${ticket.symbol}` ? "Saving..." : "Save to portfolio"}
              </Button>
              <Button variant="secondary" onClick={() => setTicket(null)}>
                Cancel
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Actual entry price</label>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                value={ticket.entryPrice}
                onChange={(e) =>
                  setTicket((prev) => (prev ? { ...prev, entryPrice: e.target.value } : prev))
                }
                inputMode="decimal"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Actual stop</label>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                value={ticket.stop}
                onChange={(e) =>
                  setTicket((prev) => (prev ? { ...prev, stop: e.target.value } : prev))
                }
                inputMode="decimal"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Actual shares</label>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                value={ticket.shares}
                onChange={(e) =>
                  setTicket((prev) => (prev ? { ...prev, shares: e.target.value } : prev))
                }
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Recommended entry" value={ticket.plannedEntry.toFixed(2)} />
            <StatCard label="Recommended stop" value={ticket.plannedStop.toFixed(2)} />
            <StatCard label="Recommended shares" value={String(ticket.plannedShares)} />
            <StatCard label="Actual capital" value={money(actualPositionValue, ticket.currency)} />
            <StatCard label="Actual risk" value={money(actualRisk, ticket.currency)} />
          </div>
        </div>
      ) : null}

      {/* Compact table with fixed column sizing */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[40%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 bg-white text-xs font-semibold uppercase tracking-wide muted">
              <th className="px-4 py-3 text-left">Symbol</th>
              <th className="px-2 py-3 text-left">Signal</th>
              <th className="px-2 py-3 text-right">Confidence</th>
              <th className="px-2 py-3 text-right">Entry</th>
              <th className="px-2 py-3 text-right">Stop</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r, idx) => {
              const isOpen = expanded === r.symbol;

              return (
                <Fragment key={r.symbol}>
                  <tr
                    className={[
                      "border-b border-slate-100 transition-colors hover:bg-emerald-50/40",
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/40",
                    ].join(" ")}
                  >
                    <td className="px-4 py-3 font-mono font-semibold whitespace-nowrap">
                      {r.symbol}
                    </td>
                    <td className="px-2 py-3">
                      <Badge variant={variant(r.signal)}>{r.signal}</Badge>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap font-mono text-right">
                      {r.confidence}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap font-mono text-right">
                      {fmt(r.entry)}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap font-mono text-right">
                      {fmt(r.stop)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2 flex-nowrap whitespace-nowrap">
                        <Button
                          variant="secondary"
                          className="px-3 py-2 text-sm whitespace-nowrap"
                          disabled={
                            r.entry == null || r.stop == null || busyKey === `size-${r.symbol}`
                          }
                          onClick={() => calculatePlan(r)}
                        >
                          {busyKey === `size-${r.symbol}` ? "…" : "Calc"}
                        </Button>

                        <Button
                          variant="primary"
                          className="px-4 py-2 text-sm whitespace-nowrap"
                          disabled={r.entry == null || r.stop == null}
                          onClick={() => handleOpen(r)}
                        >
                          Open
                        </Button>

                        <Button
                          variant="ghost"
                          className="px-4 py-2 text-sm whitespace-nowrap"
                          onClick={() => toggleExpanded(r.symbol)}
                        >
                          {isOpen ? "Hide" : "Details"}
                        </Button>
                      </div>
                    </td>
                  </tr>

                  {/* Accordion details */}
                  {isOpen ? (
                    <tr>
                      <td colSpan={6} className="bg-white px-4 pb-4 pt-2">
                        <div className="grid gap-4 lg:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                      <div className="text-sm font-semibold">Levels</div>
                      <div className="mt-2 text-sm muted space-y-1">
                        <div>
                          TP1:{" "}
                          <span className="font-mono font-semibold text-slate-900">
                            {fmt(r.tp1)}
                          </span>
                        </div>
                        <div>
                          TP2:{" "}
                          <span className="font-mono font-semibold text-slate-900">
                            {fmt(r.tp2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 lg:col-span-2">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">Why this signal</div>
                        <Button
                          variant="secondary"
                          disabled={busyKey === `why-${r.symbol}`}
                          onClick={() => loadWhy(r.symbol)}
                        >
                          {busyKey === `why-${r.symbol}` ? "Loading..." : "Load Why"}
                        </Button>
                      </div>

                      {why && why.symbol === r.symbol ? (
                        <div className="mt-3">
                          <div className="text-sm">{why.reason_summary ?? "—"}</div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {(why.reason_json?.checks ?? []).map((c: any, i: number) => (
                              <CheckLine
                                key={i}
                                ok={Boolean(c.ok)}
                                label={String(c.label ?? "")}
                                detail={c.detail ? String(c.detail) : undefined}
                              />
                            ))}
                          </div>

                          <div className="mt-4 border-t border-slate-200 pt-4">
                            <div className="text-sm font-semibold">Score breakdown</div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {(why.reason_json?.score_breakdown ?? []).map((b: any, i: number) => (
                                <div
                                  key={i}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                >
                                  <div className="text-sm font-medium">{String(b.k)}</div>
                                  <div className="text-sm muted">Points: {String(b.pts)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 text-sm muted">
                          Click “Load Why” to fetch the explanation for {r.symbol}.
                        </div>
                      )}
                    </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 muted text-sm">
                  No rows match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
