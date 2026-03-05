type GetOrRepairArgs = {
  supabase: any;
  user_id: string;
};

const DEFAULT_PORTFOLIO_PAYLOAD = {
  name: "Main",
  account_currency: "USD",
  account_size: 100000,
  risk_per_trade: 0.02,
  max_positions: 5,
};

export async function getOrRepairDefaultPortfolio(opts: GetOrRepairArgs) {
  const supa = opts.supabase as any;
  const userId = String(opts.user_id ?? "").trim();
  if (!userId) return null;

  const { data: existingDefault, error: existingDefaultErr } = await supa
    .from("portfolios")
    .select("*")
    .eq("user_id", userId)
    .eq("is_default", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingDefaultErr) throw existingDefaultErr;
  if (existingDefault?.id) return existingDefault;

  const { data: firstPortfolio, error: firstPortfolioErr } = await supa
    .from("portfolios")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstPortfolioErr) throw firstPortfolioErr;

  if (firstPortfolio?.id) {
    const { error: clearErr } = await supa
      .from("portfolios")
      .update({ is_default: false })
      .eq("user_id", userId);
    if (clearErr) throw clearErr;

    const { data: markedDefault, error: markErr } = await supa
      .from("portfolios")
      .update({ is_default: true, user_id: userId })
      .eq("id", firstPortfolio.id)
      .eq("user_id", userId)
      .select("*")
      .limit(1)
      .maybeSingle();
    if (markErr) throw markErr;
    if (markedDefault?.id) return markedDefault;
  }

  const { data: inserted, error: insertErr } = await supa
    .from("portfolios")
    .insert({
      ...DEFAULT_PORTFOLIO_PAYLOAD,
      user_id: userId,
      is_default: true,
    })
    .select("*")
    .limit(1)
    .maybeSingle();
  if (insertErr) throw insertErr;
  return inserted ?? null;
}
