import { NextResponse } from "next/server";

type BacktestBody = {
  strategy_version?: string;
  universe_slug?: string;
  start_date?: string;
  end_date?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as BacktestBody;
    const inputs = {
      strategy_version: String(body.strategy_version ?? "v2_core_momentum"),
      universe_slug: String(body.universe_slug ?? "core_800"),
      start_date: String(body.start_date ?? ""),
      end_date: String(body.end_date ?? ""),
    };
    return NextResponse.json({
      ok: true,
      note: "Backtest scaffolding v1 (implementation next)",
      inputs,
    });
  } catch (e: unknown) {
    console.error("backtest run error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

