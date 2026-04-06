import type { EarningsRisk } from "@/lib/earnings_risk";

export type TickerProfile = {
  symbol: string;
  name: string | null;
  market_cap: number | null;
  primary_exchange: string | null;
  type: string | null;
  sic_description: string | null;
  description: string | null;
};

export type IdeaCatalystContext = {
  summary: string;
  state: "ACTIVE" | "QUIET" | "RISK" | "IMPROVING";
  positives: string[];
  risks: string[];
  company_context: string[];
};

type Input = {
  symbol: string;
  earnings: EarningsRisk | null | undefined;
  change_status?: "NEW" | "UPGRADED" | "UNCHANGED" | "DOWNGRADED" | null;
  candidate_state_label?: string | null;
  blockers?: string[] | null;
  symbol_facts?: {
    above_sma200?: boolean | null;
    above_sma50?: boolean | null;
    liquidity_state?: string | null;
    volatility_state?: string | null;
  } | null;
  profile?: TickerProfile | null;
};

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function fmtCap(cap: number | null | undefined) {
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return null;
  if (cap >= 1_000_000_000_000) return `${(cap / 1_000_000_000_000).toFixed(2)}T`;
  if (cap >= 1_000_000_000) return `${(cap / 1_000_000_000).toFixed(1)}B`;
  if (cap >= 1_000_000) return `${(cap / 1_000_000).toFixed(1)}M`;
  return `${Math.round(cap)}`;
}

export function buildIdeaCatalystContext(input: Input): IdeaCatalystContext {
  const positives: string[] = [];
  const risks: string[] = [];
  const companyContext: string[] = [];
  const blockers = Array.isArray(input.blockers) ? input.blockers : [];
  const earnings = input.earnings ?? null;
  const profile = input.profile ?? null;
  const facts = input.symbol_facts ?? null;

  if (earnings?.earningsRiskState === "block") {
    risks.push(`Earnings in ${earnings.daysToEarnings ?? "?"} day(s)`);
  } else if (earnings?.earningsRiskState === "warn") {
    risks.push(`Earnings upcoming in ${earnings.daysToEarnings ?? "?"} day(s)`);
  } else {
    positives.push("No near-term earnings blocker");
  }

  if (input.change_status === "NEW") positives.push("Newly surfaced in the latest scan");
  if (input.change_status === "UPGRADED") positives.push("Improved vs prior scan");
  if (input.change_status === "DOWNGRADED") risks.push("Setup weakened vs prior scan");

  if (facts?.above_sma200) positives.push("Still above SMA200");
  else if (facts?.above_sma200 === false) risks.push("Below SMA200");

  if (facts?.liquidity_state === "institutional" || facts?.liquidity_state === "liquid") {
    positives.push("Liquidity profile is healthy");
  }
  if (facts?.volatility_state === "high") risks.push("Volatility is elevated");

  for (const blocker of blockers) {
    if (/Earnings/i.test(blocker) || /Market regime/i.test(blocker)) continue;
    if (/Too extended/i.test(blocker)) risks.push("Timing is extended");
    else if (/Relative volume/i.test(blocker)) risks.push("Participation is still soft");
  }

  if (profile?.sic_description) companyContext.push(profile.sic_description);
  if (profile?.primary_exchange) companyContext.push(profile.primary_exchange);
  const capLabel = fmtCap(profile?.market_cap);
  if (capLabel) companyContext.push(`Mkt cap ${capLabel}`);

  const summary =
    earnings?.earningsRiskState === "block"
      ? `Catalyst risk elevated: earnings are too close for a clean daily swing entry.`
      : input.change_status === "UPGRADED" || input.change_status === "NEW"
      ? `Catalyst tone is constructive: this setup is improving into the latest scan.`
      : blockers.length > 0
      ? `Catalyst tone is mixed: no major external catalyst, but the setup still has technical blockers.`
      : `Catalyst tone is calm: no obvious near-term event blocker is visible.`;

  const state: IdeaCatalystContext["state"] =
    earnings?.earningsRiskState === "block"
      ? "RISK"
      : input.change_status === "UPGRADED" || input.change_status === "NEW"
      ? "IMPROVING"
      : risks.length > 0
      ? "ACTIVE"
      : "QUIET";

  return {
    summary,
    state,
    positives: unique(positives).slice(0, 4),
    risks: unique(risks).slice(0, 4),
    company_context: unique(companyContext).slice(0, 4),
  };
}
