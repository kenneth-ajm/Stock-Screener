import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLCTD } from "@/lib/scan_status";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as any;
  const lctd = await getLCTD(supabase);
  return NextResponse.json({
    ok: true,
    last_completed_trading_day: lctd.lctd,
    source: lctd.source,
  });
}
