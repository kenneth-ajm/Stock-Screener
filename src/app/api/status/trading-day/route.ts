import { NextResponse } from "next/server";
import { lastCompletedUsTradingDay } from "@/lib/tradingDay";

export async function GET() {
  return NextResponse.json({
    ok: true,
    last_completed_trading_day: lastCompletedUsTradingDay(),
  });
}

