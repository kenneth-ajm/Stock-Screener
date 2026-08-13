import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Compatibility entry point for old bookmarks. The former Screener duplicated
 * Ideas queries and could retain an invalid strategy/universe combination.
 * Ideas is now the only user-facing scan and recommendation workspace.
 */
export default async function ScreenerPage({
  searchParams,
}: {
  searchParams?: Promise<{ strategy?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const requested = String(params.strategy ?? "v1").trim();
  const strategy = requested === "v1_trend_hold" ? "v1_trend_hold" : "v1";
  redirect(`/ideas?strategy=${encodeURIComponent(strategy)}`);
}
