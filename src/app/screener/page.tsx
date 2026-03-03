import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import UtilitiesClient from "./UtilitiesClient";
import ScanTableClient from "./scanTableClient";

const DEFAULT_UNIVERSE = "liquid_2000";

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export default async function ScreenerPage() {
  // ✅ Next cookies() is async in newer versions
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // ✅ Newer @supabase/ssr expects getAll + setAll
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // If called during Server Component render, Next may throw.
            // It's safe to ignore because auth refresh writes are best-effort here.
          }
        },
      },
    }
  );

  const universe_slug = DEFAULT_UNIVERSE;
  const today = isoDate();

  // These can be wired to portfolio later; keeping sane defaults for now
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
        initialRows={(scans ?? []).map((r: any) => ({
          symbol: r.symbol,
          signal: r.signal,
          confidence: r.confidence,
          entry: r.entry,
          stop: r.stop,
          tp1: r.tp1,
          tp2: r.tp2,
        }))}
        accountSize={accountSize}
        riskPerTrade={riskPerTrade}
        capitalDeployed={capitalDeployed}
      />
    </div>
  );
}