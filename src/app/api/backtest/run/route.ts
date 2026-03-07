import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runMomentumBacktest } from "@/lib/backtest_momentum";
import { OBS_KEYS, writeObservabilityStatus } from "@/lib/observability";

type BacktestBody = {
  strategy_version?: string;
  universe_slug?: string;
  start_date?: string;
  end_date?: string;
  entry_mode?: "trigger" | "next_open" | "next_close" | string;
};

function normalizeEntryMode(v: unknown): "trigger" | "next_open" | "next_close" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "next_open" || s === "next_close" || s === "trigger") return s;
  return "trigger";
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as BacktestBody;
    const strategy = String(body.strategy_version ?? "v2_core_momentum").trim() || "v2_core_momentum";
    const supabase = admin() as any;
    const inputs = {
      strategy_version: strategy,
      universe_slug: String(body.universe_slug ?? "core_800").trim() || "core_800",
      start_date: String(body.start_date ?? "").slice(0, 10),
      end_date: String(body.end_date ?? "").slice(0, 10),
      entry_mode: normalizeEntryMode(body.entry_mode),
    };
    const result = await runMomentumBacktest({ supabase, input: inputs });
    const payload = {
      ok: true,
      inputs,
      summary: result.summary,
      trades: result.trades,
      equity_curve: result.equity_curve,
      assumptions: result.assumptions,
      metrics: {
        trades: result.summary.total_trades,
        win_rate: result.summary.win_rate,
        avg_return_pct: result.summary.avg_return_pct,
        profit_factor: result.summary.profit_factor,
        avg_hold_days: result.summary.avg_holding_days,
        max_drawdown_pct: result.summary.max_drawdown_pct,
      },
    };
    await writeObservabilityStatus({
      supabase,
      key: OBS_KEYS.backtest,
      value: {
        ok: true,
        strategy_version: inputs.strategy_version,
        universe_slug: inputs.universe_slug,
        start_date: inputs.start_date,
        end_date: inputs.end_date,
        entry_mode: inputs.entry_mode,
        candidate_rows: result.summary.candidate_rows,
        triggered_trades: result.summary.triggered_trades,
        not_triggered_trades: result.summary.not_triggered_trades,
        skipped_trades: result.summary.skipped_trades,
        total_trades: result.summary.total_trades,
      },
    });
    return NextResponse.json(payload);
  } catch (e: unknown) {
    console.error("backtest run error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    await writeObservabilityStatus({
      key: OBS_KEYS.backtest,
      value: { ok: false, error },
    }).catch(() => null);
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
