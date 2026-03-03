import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import UtilitiesClient from "./UtilitiesClient";
import ScanTableClient from "./scanTableClient";

const DEFAULT_UNIVERSE = "liquid_2000";

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export default async function ScreenerPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // ignore best-effort cookie writes during server component render
          }
        },
      },
    }
  );

  const universe_slug = DEFAULT_UNIVERSE;
  const today = isoDate();

  // placeholders (wire to portfolio later)
  const accountSize = 20000;
  const riskPerTrade = 0.01;
  const capitalDeployed = 0;

  const { data: scans } = await supabase
    .from("daily_scans")
    .select("symbol,signal,confidence,entry,stop,tp1,tp2,date")
    .eq("date", today)
    .eq("universe_slug", universe_slug)
    .order("confidence", { ascending: false })
    .limit(400);

  const rows =
    (scans ?? []).map((r: any) => ({
      symbol: r.symbol,
      signal: r.signal,
      confidence: r.confidence,
      entry: r.entry,
      stop: r.stop,
      tp1: r.tp1,
      tp2: r.tp2,
    })) ?? [];

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4">
        <div className="text-xl font-semibold">Screener</div>
        <div className="text-sm text-muted-foreground">
          Default universe is <span className="font-mono">{universe_slug}</span>. Signals are daily + cache-first.
        </div>
      </div>

      <div className="mb-6">
        <UtilitiesClient />
      </div>

      <ScanTableClient
        universeSlug={universe_slug}
        scanDate={today}
        rows={rows}
        accountSize={accountSize}
        riskPerTrade={riskPerTrade}
        capitalDeployed={capitalDeployed}
      />
    </div>
  );
}