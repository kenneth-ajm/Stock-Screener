"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CockpitCandidate, CockpitPosition, DailyCockpitPayload } from "@/lib/daily_cockpit";
import { money, percent } from "@/lib/daily_cockpit";

type LoadState = "loading" | "ready" | "failed";

function stateClass(state: CockpitCandidate["state"]) {
  return state === "ACT_NOW"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-800";
}

function executionClass(state: CockpitCandidate["execution_state"]) {
  if (state === "ENTRY_ALIGNED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "DO_NOT_CHASE") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function managementClass(state: CockpitPosition["management_state"]) {
  if (state === "STOP_BREACHED") return "border-rose-200 bg-rose-50 text-rose-800";
  if (state === "TP1_REACHED" || state === "TP2_REACHED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (state === "TIME_REVIEW") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function compactTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function CandidateCard({ candidate }: { candidate: CockpitCandidate }) {
  const liveDiff =
    candidate.quote_price != null && candidate.reference_price != null && candidate.reference_price > 0
      ? ((candidate.quote_price - candidate.reference_price) / candidate.reference_price) * 100
      : null;
  return (
    <article className="surface-card flex h-full flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold tracking-tight text-slate-950">{candidate.symbol}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stateClass(candidate.state)}`}>
              {candidate.state_label}
            </span>
          </div>
          <p className="mt-0.5 text-xs font-medium text-slate-500">
            {candidate.playbook_label} · {candidate.setup_label} · {candidate.expected_hold}
          </p>
        </div>
        {candidate.score != null ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-right">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Quality</div>
            <div className="text-sm font-semibold text-slate-900">{candidate.score.toFixed(0)}</div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Entry</div>
          <div className="mt-0.5 text-sm font-semibold">{money(candidate.entry_price)}</div>
        </div>
        <div className="rounded-lg border border-rose-100 bg-rose-50/60 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-rose-600">Stop</div>
          <div className="mt-0.5 text-sm font-semibold text-rose-800">{money(candidate.stop_price)}</div>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700">TP1</div>
          <div className="mt-0.5 text-sm font-semibold text-emerald-900">{money(candidate.tp1_price)}</div>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700">TP2</div>
          <div className="mt-0.5 text-sm font-semibold text-emerald-900">{money(candidate.tp2_price)}</div>
        </div>
        <div className="rounded-lg border border-sky-100 bg-sky-50/60 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-sky-700">
            {candidate.quote_price != null ? "Snapshot" : "Daily close"}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-sky-900">
            {money(candidate.quote_price ?? candidate.reference_price)}
          </div>
          {liveDiff != null ? <div className="text-[10px] text-sky-700">{percent(liveDiff)} vs close</div> : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${executionClass(candidate.execution_state)}`}>
          {candidate.execution_label}
        </span>
        {candidate.details.map((detail) => (
          <span key={detail.label} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
            {detail.label}: <strong className="font-semibold text-slate-800">{detail.value}</strong>
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-2 text-sm leading-5 text-slate-600 sm:grid-cols-2">
        <div>
          <span className="font-semibold text-slate-800">Why it is here: </span>
          {candidate.reason_summary}
        </div>
        <div>
          <span className="font-semibold text-slate-800">Next decision: </span>
          {candidate.next_trigger}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="text-[11px] text-slate-500">
          Signal bars through {candidate.source_date ?? "—"}
          {candidate.quote_as_of ? ` · quote ${compactTime(candidate.quote_as_of)}` : ""}
        </div>
        <Link
          href={candidate.ticket_href}
          className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
            candidate.state === "ACT_NOW"
              ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
              : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
          }`}
        >
          {candidate.state === "ACT_NOW" ? "Open Trade Ticket" : "Prepare Trade"}
        </Link>
      </div>
    </article>
  );
}

function PositionCard({ position }: { position: CockpitPosition }) {
  return (
    <article className="surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-950">{position.symbol}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${managementClass(position.management_state)}`}>
              {position.management_label}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {position.strategy_label} · {position.quantity} shares · {position.lots} {position.lots === 1 ? "lot" : "lots"}
          </div>
        </div>
        <div className={`text-sm font-semibold ${(position.unrealized_pct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
          {percent(position.unrealized_pct)}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2 text-xs">
        <div><span className="text-slate-500">Avg entry</span><div className="font-semibold">{money(position.average_entry)}</div></div>
        <div><span className="text-slate-500">Current</span><div className="font-semibold">{money(position.current_price)}</div></div>
        <div><span className="text-slate-500">Stop</span><div className="font-semibold text-rose-700">{money(position.stop_price)}</div></div>
        <div><span className="text-slate-500">TP1</span><div className="font-semibold text-emerald-700">{money(position.tp1_price)}</div></div>
        <div><span className="text-slate-500">TP2</span><div className="font-semibold text-emerald-700">{money(position.tp2_price)}</div></div>
      </div>
      <p className="mt-3 text-sm leading-5 text-slate-600">{position.management_summary}</p>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="text-[11px] text-slate-500">
          {position.held_days != null ? `${position.held_days}d held` : "Hold date unavailable"}
          {position.max_hold_days != null ? ` · ${position.max_hold_days}d plan` : ""}
        </div>
        <Link href="/positions" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
          Manage Position
        </Link>
      </div>
    </article>
  );
}

export default function DailyCockpitClient() {
  const [payload, setPayload] = useState<DailyCockpitPayload | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 65_000);
    try {
      const response = await fetch(`/api/daily-cockpit?view=${Date.now()}`, { cache: "no-store", signal: controller.signal });
      const json = (await response.json().catch(() => null)) as (DailyCockpitPayload & { error?: string }) | null;
      if (!response.ok || !json?.ok) throw new Error(json?.error ?? "Daily cockpit failed to load");
      setPayload(json);
      setState("ready");
    } catch (loadError: unknown) {
      setError(loadError instanceof Error && loadError.name === "AbortError" ? "The daily feed exceeded 65 seconds. Retry once; cached results should then load quickly." : loadError instanceof Error ? loadError.message : String(loadError));
      setState("failed");
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const managementRows = useMemo(
    () => payload?.positions.filter((position) => position.management_state !== "HOLD") ?? [],
    [payload]
  );

  if (state === "loading" && !payload) {
    return (
      <div className="surface-panel p-8">
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-2/5 animate-pulse rounded-full bg-emerald-500" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-slate-900">Preparing the daily decision list</h2>
        <p className="mt-1 text-sm text-slate-600">Reading completed daily bars, cached playbooks, current quote context, and open positions.</p>
      </div>
    );
  }

  if (state === "failed" && !payload) {
    return (
      <div className="surface-panel border-rose-200 p-6">
        <h2 className="text-lg font-semibold text-rose-900">Daily cockpit unavailable</h2>
        <p className="mt-2 text-sm text-rose-700">{error}</p>
        <button onClick={() => void load()} className="mt-4 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50">
          Retry
        </button>
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className="space-y-5">
      <section className="surface-panel overflow-hidden">
        <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#edf8f3_100%)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="muted-label">Daily decision workflow</div>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">What needs attention now</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Signals use completed daily bars. Provider snapshots help judge entry alignment but never create or upgrade a signal.
              </p>
            </div>
            <button
              onClick={() => void load()}
              disabled={state === "loading"}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
            >
              {state === "loading" ? "Refreshing view…" : "Refresh view"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full border px-2.5 py-1 font-medium ${payload.market.freshness_state === "current" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              Daily bars: {payload.market.source_date ?? "unavailable"}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
              Expected: {payload.market.expected_completed_session}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
              {payload.market.provider_label}: {payload.market.provider_configured ? "connected" : "not configured"}
            </span>
            <span className={`rounded-full border px-2.5 py-1 ${payload.market.spy_healthy === true ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              Market: {payload.market.regime_label}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
              Updated {compactTime(payload.generated_at)}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
          {[
            ["Act now", payload.summary.act_now, "Confirmed daily setups"],
            ["Near trigger", payload.summary.near_trigger, "Prepare, do not anticipate"],
            ["Manage", payload.summary.positions_to_manage, "Stops, targets, or time"],
            ["Cash", money(payload.portfolio.cash_available), `${payload.portfolio.open_symbols} open symbols`],
          ].map(([label, value, note]) => (
            <div key={String(label)} className="bg-white px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
              <div className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
              <div className="mt-0.5 text-xs text-slate-500">{note}</div>
            </div>
          ))}
        </div>
      </section>

      {payload.warnings.length > 0 || error ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Data attention</div>
          <div className="mt-1">{[...payload.warnings, ...(error ? [error] : [])].join(" ")}</div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="muted-label">Priority 1</div>
            <h2 className="section-title mt-1">Act Now</h2>
            <p className="mt-1 text-sm text-slate-600">Confirmed daily setups only. Entry still depends on price alignment and cash risk.</p>
          </div>
          <Link href="/ideas?strategy=tactical_momentum" className="text-xs font-semibold text-slate-600 hover:text-slate-950">Open full research →</Link>
        </div>
        {payload.act_now.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">{payload.act_now.map((candidate) => <CandidateCard key={`${candidate.playbook}:${candidate.symbol}`} candidate={candidate} />)}</div>
        ) : (
          <div className="surface-panel p-5">
            <div className="text-base font-semibold text-slate-900">No confirmed entries from the two active playbooks.</div>
            <p className="mt-1 text-sm leading-6 text-slate-600">This is a valid daily result, not a broken page. Prepare the Near Trigger list and avoid inventing a trade.</p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <div className="muted-label">Priority 2</div>
          <h2 className="section-title mt-1">Near Trigger</h2>
          <p className="mt-1 text-sm text-slate-600">The next-best setups with an explicit condition that must improve before entry.</p>
        </div>
        {payload.near_trigger.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">{payload.near_trigger.map((candidate) => <CandidateCard key={`${candidate.playbook}:${candidate.symbol}`} candidate={candidate} />)}</div>
        ) : (
          <div className="surface-panel p-5 text-sm text-slate-600">No near-trigger candidates are available from the current cached bars.</div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="muted-label">Priority 3</div>
            <h2 className="section-title mt-1">Manage Positions</h2>
            <p className="mt-1 text-sm text-slate-600">Only positions needing a stop, target, or time-window decision are emphasized.</p>
          </div>
          <Link href="/positions" className="text-xs font-semibold text-slate-600 hover:text-slate-950">All positions →</Link>
        </div>
        {managementRows.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">{managementRows.map((position) => <PositionCard key={position.symbol} position={position} />)}</div>
        ) : (
          <div className="surface-panel p-5">
            <div className="text-base font-semibold text-slate-900">No position action is due.</div>
            <p className="mt-1 text-sm text-slate-600">{payload.positions.length > 0 ? `${payload.positions.length} open position(s) remain inside their stored plans.` : "There are no open platform positions."}</p>
          </div>
        )}
      </section>

      <section className="surface-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="muted-label">Coverage</div>
            <div className="mt-1 text-sm text-slate-700">
              Fast Momentum evaluated {payload.sources.tactical.scanned_symbols} liquid candidates · Quality Pullback evaluated {payload.sources.quality.watchlist_size} curated names.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Check a ticker</Link>
            <Link href="/ideas" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Research lab</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
