import type { SectorMomentumRow } from "@/lib/sector_momentum";

export type LeadershipContext = {
  state: "LEADING" | "IMPROVING" | "WEAK" | "UNKNOWN";
  label: string;
  summary: string;
  strengths: string[];
  warnings: string[];
  industry_group: string | null;
  theme: string | null;
  group_rank_score: number | null;
};

type Input = {
  industry_group?: string | null;
  theme?: string | null;
  group?: SectorMomentumRow | null;
};

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function leadershipLabel(state: LeadershipContext["state"]) {
  switch (state) {
    case "LEADING":
      return "Leadership Strong";
    case "IMPROVING":
      return "Leadership Improving";
    case "WEAK":
      return "Leadership Weak";
    default:
      return "Leadership Unknown";
  }
}

export function buildIdeaLeadershipContext(input: Input): LeadershipContext {
  const group = input.group ?? null;
  const industryGroup = String(input.industry_group ?? group?.name ?? "").trim() || null;
  const theme = String(input.theme ?? group?.theme ?? "").trim() || null;

  if (!group) {
    return {
      state: "UNKNOWN",
      label: leadershipLabel("UNKNOWN"),
      summary: "No sector/theme leadership context is available for this symbol yet.",
      strengths: [],
      warnings: [],
      industry_group: industryGroup,
      theme,
      group_rank_score: null,
    };
  }

  const strengths: string[] = [];
  const warnings: string[] = [];

  if (group.state === "LEADING") strengths.push(`${group.name} is one of the strongest groups right now`);
  if (group.state === "IMPROVING") strengths.push(`${group.name} breadth is improving`);
  if (group.pct_above_sma50 >= 60) strengths.push(`${group.pct_above_sma50.toFixed(0)}% of the group is above SMA50`);
  if (group.pct_above_sma200 >= 45) strengths.push(`${group.pct_above_sma200.toFixed(0)}% of the group is above SMA200`);
  if (group.breakout_participation >= 30) strengths.push(`Breakout participation is healthy at ${group.breakout_participation.toFixed(0)}%`);
  if (group.rs_10d > 0) strengths.push(`10-day relative strength vs SPY is positive`);

  if (group.state === "WEAK") warnings.push(`${group.name} leadership is weak right now`);
  if (group.pct_above_sma50 < 45) warnings.push(`Only ${group.pct_above_sma50.toFixed(0)}% of the group is above SMA50`);
  if (group.pct_above_sma200 < 30) warnings.push(`Only ${group.pct_above_sma200.toFixed(0)}% of the group is above SMA200`);
  if (group.breakout_participation < 20) warnings.push("Breakout participation is still limited");
  if (group.rs_10d <= 0) warnings.push("10-day relative strength vs SPY is not supportive");

  const summary =
    group.state === "LEADING"
      ? `${group.name} is currently leading with RS10 ${(group.rs_10d * 100).toFixed(1)}% and ${group.pct_above_sma50.toFixed(0)}% above SMA50.`
      : group.state === "IMPROVING"
      ? `${group.name} is improving, but breadth participation still needs monitoring.`
      : `${group.name} is not showing strong leadership right now.`;

  return {
    state: group.state,
    label: leadershipLabel(group.state),
    summary,
    strengths: unique(strengths).slice(0, 4),
    warnings: unique(warnings).slice(0, 4),
    industry_group: industryGroup,
    theme,
    group_rank_score: Number.isFinite(Number(group.rank_score)) ? Number(group.rank_score) : null,
  };
}
