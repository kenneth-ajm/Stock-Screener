import { getLCTD as getLctdStatus } from "@/lib/scan_status";

export async function getLCTD(supabase: any) {
  const status = await getLctdStatus(supabase);
  if (status.lctd) {
    return {
      ok: true as const,
      scan_date: status.lctd,
      lctd_source: status.source,
      error: null,
    };
  }
  return {
    ok: false as const,
    scan_date: null,
    lctd_source: status.source,
    error: "No price_bars available",
  };
}
