export async function getLCTD(supabase: any) {
  const supa = supabase as any;

  const { data: spyData, error: spyErr } = await supa
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  if (!spyErr && spyData?.[0]?.date) {
    return {
      ok: true as const,
      scan_date: String(spyData[0].date),
      lctd_source: "spy_max_date" as const,
      error: null,
    };
  }

  const { data: anyData, error: anyErr } = await supa
    .from("price_bars")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);

  if (!anyErr && anyData?.[0]?.date) {
    return {
      ok: true as const,
      scan_date: String(anyData[0].date),
      lctd_source: "global_max_date" as const,
      error: null,
    };
  }

  return {
    ok: false as const,
    scan_date: null,
    lctd_source: "none" as const,
    error: spyErr?.message || anyErr?.message || "No price_bars available",
  };
}
