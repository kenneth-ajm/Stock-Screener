import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const { symbol } = await req.json();
  if (!symbol) return NextResponse.json({ ok:false, error:"Symbol required" });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: bars } = await supabase
    .from("price_bars")
    .select("high,low,close,volume,date")
    .eq("symbol", symbol.toUpperCase())
    .order("date",{ascending:true});

  if (!bars || bars.length < 220)
    return NextResponse.json({ ok:false, error:"Not enough history" });

  const closes = bars.map((b:any)=>Number(b.close));
  const latest = closes[closes.length-1];

  const sma50 = closes.slice(-50).reduce((a,b)=>a+b,0)/50;
  const sma200 = closes.slice(-200).reduce((a,b)=>a+b,0)/200;

  const above50 = latest > sma50;
  const above200 = latest > sma200;

  const signal = above50 && above200 ? "BUY candidate" : "Not aligned";

  return NextResponse.json({
    ok:true,
    symbol: symbol.toUpperCase(),
    price: latest,
    above50,
    above200,
    signal
  });
}