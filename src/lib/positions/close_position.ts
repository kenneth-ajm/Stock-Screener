type PositionRecord = {
  id: string;
  user_id: string;
  portfolio_id?: string | null;
  symbol: string;
  status: string;
  strategy_version?: string | null;
  max_hold_days?: number | null;
  tp_model?: string | null;
  tp_plan?: string | null;
  tp1_pct?: number | null;
  tp2_pct?: number | null;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp1_size_pct?: number | null;
  tp2_size_pct?: number | null;
  entry_date?: string | null;
  entry_price?: number | null;
  entry_fee?: number | null;
  stop_price?: number | null;
  stop?: number | null;
  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;
  exit_price?: number | null;
  exit_fee?: number | null;
  closed_at?: string | null;
  exit_reason?: string | null;
  exit_date?: string | null;
  created_at?: string | null;
};

function resolveQty(row: PositionRecord) {
  const value =
    (typeof row.shares === "number" ? row.shares : null) ??
    (typeof row.quantity === "number" ? row.quantity : null) ??
    (typeof row.position_size === "number" ? row.position_size : null) ??
    0;
  return Number.isFinite(value) ? value : 0;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function buildQtyPatch(qty: number) {
  return {
    shares: qty,
    quantity: qty,
    position_size: qty,
  };
}

function allocateFees(totalFee: number | null, closedQty: number, totalQty: number) {
  if (totalFee == null || !Number.isFinite(totalFee) || totalFee <= 0 || !(totalQty > 0)) {
    return { closedFee: null as number | null, remainingFee: null as number | null };
  }
  const closedFee = round2(totalFee * (closedQty / totalQty));
  const remainingFee = round2(totalFee - closedFee);
  return { closedFee, remainingFee };
}

function cloneClosedRow(row: PositionRecord, closedQty: number, exitPrice: number, exitFee: number | null, exitReason: string, closedAt: string, exitDate: string, entryFee: number | null) {
  return {
    portfolio_id: row.portfolio_id ?? null,
    user_id: row.user_id,
    symbol: row.symbol,
    status: "CLOSED",
    strategy_version: row.strategy_version ?? null,
    max_hold_days: row.max_hold_days ?? null,
    tp_model: row.tp_model ?? null,
    tp_plan: row.tp_plan ?? null,
    tp1_pct: row.tp1_pct ?? null,
    tp2_pct: row.tp2_pct ?? null,
    tp1_price: row.tp1_price ?? null,
    tp2_price: row.tp2_price ?? null,
    tp1_size_pct: row.tp1_size_pct ?? null,
    tp2_size_pct: row.tp2_size_pct ?? null,
    entry_date: row.entry_date ?? null,
    entry_price: row.entry_price ?? null,
    entry_fee: entryFee,
    stop_price:
      (typeof row.stop_price === "number" ? row.stop_price : null) ??
      (typeof row.stop === "number" ? row.stop : null),
    ...buildQtyPatch(closedQty),
    exit_price: exitPrice,
    exit_fee: exitFee,
    closed_at: closedAt,
    exit_reason: exitReason,
    exit_date: exitDate,
  };
}

function stripUnsupportedCloseColumns<T extends Record<string, unknown>>(payload: T, message: string) {
  const next = { ...payload };
  const msg = String(message ?? "");
  if (/exit_date/i.test(msg)) delete (next as any).exit_date;
  if (/exit_reason/i.test(msg)) delete (next as any).exit_reason;
  if (/exit_fee/i.test(msg)) delete (next as any).exit_fee;
  return next;
}

async function safeUpdateClosedPosition(opts: {
  supabase: any;
  userId: string;
  positionId: string;
  patch: Record<string, unknown>;
}) {
  const attempt = async (patch: Record<string, unknown>) =>
    opts.supabase
      .from("portfolio_positions")
      .update(patch)
      .eq("id", opts.positionId)
      .eq("user_id", opts.userId)
      .select("id,status,closed_at,exit_price,quantity,shares,position_size")
      .maybeSingle();

  let result = await attempt(opts.patch);
  if (result.error && /exit_date|exit_reason|exit_fee/i.test(result.error.message ?? "")) {
    result = await attempt(stripUnsupportedCloseColumns(opts.patch, result.error.message ?? ""));
  }
  if (result.error) throw new Error(result.error.message);
  return result.data ?? null;
}

async function safeInsertClosedPosition(opts: {
  supabase: any;
  row: Record<string, unknown>;
}) {
  const attempt = async (row: Record<string, unknown>) =>
    opts.supabase
      .from("portfolio_positions")
      .insert(row)
      .select("id,status,closed_at,exit_price,quantity,shares,position_size")
      .maybeSingle();

  let result = await attempt(opts.row);
  if (result.error && /exit_date|exit_reason|exit_fee/i.test(result.error.message ?? "")) {
    result = await attempt(stripUnsupportedCloseColumns(opts.row, result.error.message ?? ""));
  }
  if (result.error) throw new Error(result.error.message);
  return result.data ?? null;
}

async function fetchOpenPosition(supabase: any, userId: string, positionId: string) {
  const { data, error } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("id", positionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Position not found");
  if (String(data.status ?? "") !== "OPEN") throw new Error("Position is not OPEN");
  return data as PositionRecord;
}

export async function closeSinglePosition(opts: {
  supabase: any;
  userId: string;
  positionId: string;
  exitPrice: number;
  exitFee: number | null;
  exitReason: string;
  closeQuantity: number;
}) {
  const row = await fetchOpenPosition(opts.supabase, opts.userId, opts.positionId);
  const totalQty = resolveQty(row);
  if (!(totalQty > 0)) throw new Error("Open position quantity is invalid");
  if (!Number.isFinite(opts.closeQuantity) || opts.closeQuantity <= 0) {
    throw new Error("close_quantity must be a positive number");
  }
  if (opts.closeQuantity - totalQty > 0.0001) {
    throw new Error(`close_quantity exceeds open quantity (${totalQty})`);
  }

  const closedAt = new Date().toISOString();
  const exitDate = closedAt.slice(0, 10);
  const fullClose = Math.abs(opts.closeQuantity - totalQty) <= 0.0001;

  if (fullClose) {
    const data = await safeUpdateClosedPosition({
      supabase: opts.supabase,
      userId: opts.userId,
      positionId: row.id,
      patch: {
        status: "CLOSED",
        closed_at: closedAt,
        exit_price: opts.exitPrice,
        exit_fee: opts.exitFee,
        exit_reason: opts.exitReason,
        exit_date: exitDate,
      },
    });
    return {
      mode: "full" as const,
      closed_count: 1,
      closed_quantity: round4(opts.closeQuantity),
      remaining_quantity: 0,
      position: data ?? null,
    };
  }

  const remainingQty = round4(totalQty - opts.closeQuantity);
  const entryFeeRaw = typeof row.entry_fee === "number" && Number.isFinite(row.entry_fee) ? row.entry_fee : null;
  const splitFees = allocateFees(entryFeeRaw, opts.closeQuantity, totalQty);

  const updatePatch = {
    ...buildQtyPatch(remainingQty),
    entry_fee: splitFees.remainingFee,
  };

  const { error: updateError } = await opts.supabase
    .from("portfolio_positions")
    .update(updatePatch)
    .eq("id", row.id)
    .eq("user_id", opts.userId);
  if (updateError) throw new Error(updateError.message);

  const closedRow = cloneClosedRow(
    row,
    round4(opts.closeQuantity),
    opts.exitPrice,
    opts.exitFee,
    opts.exitReason,
    closedAt,
    exitDate,
    splitFees.closedFee
  );

  let inserted: any = null;
  try {
    inserted = await safeInsertClosedPosition({
      supabase: opts.supabase,
      row: closedRow,
    });
  } catch (error: any) {
    await opts.supabase
      .from("portfolio_positions")
      .update({
        ...buildQtyPatch(totalQty),
        entry_fee: entryFeeRaw,
      })
      .eq("id", row.id)
      .eq("user_id", opts.userId);
    throw error;
  }

  return {
    mode: "partial" as const,
    closed_count: 1,
    closed_quantity: round4(opts.closeQuantity),
    remaining_quantity: remainingQty,
    position: inserted ?? null,
  };
}

export async function closeGroupedSymbol(opts: {
  supabase: any;
  userId: string;
  portfolioId: string;
  symbol: string;
  exitPrice: number;
  exitFee: number | null;
  exitReason: string;
  closeQuantity: number;
}) {
  const { data, error } = await opts.supabase
    .from("portfolio_positions")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("portfolio_id", opts.portfolioId)
    .eq("status", "OPEN");
  if (error) throw new Error(error.message);

  const rows = (Array.isArray(data) ? data : [])
    .filter((row: any) => String(row?.symbol ?? "").toUpperCase() === opts.symbol.toUpperCase())
    .sort((a: any, b: any) => String(a?.entry_date ?? a?.created_at ?? "").localeCompare(String(b?.entry_date ?? b?.created_at ?? ""))) as PositionRecord[];

  if (rows.length === 0) {
    throw new Error(`No OPEN lots found for ${opts.symbol.toUpperCase()}`);
  }

  const totalQty = rows.reduce((sum, row) => sum + resolveQty(row), 0);
  if (!(totalQty > 0)) throw new Error("Open grouped quantity is invalid");
  if (!Number.isFinite(opts.closeQuantity) || opts.closeQuantity <= 0) {
    throw new Error("close_quantity must be a positive number");
  }
  if (opts.closeQuantity - totalQty > 0.0001) {
    throw new Error(`close_quantity exceeds open quantity (${totalQty})`);
  }

  let remainingToClose = round4(opts.closeQuantity);
  let allocatedExitFee = 0;
  let closedCount = 0;

  for (let i = 0; i < rows.length && remainingToClose > 0.0001; i += 1) {
    const row = rows[i];
    const rowQty = resolveQty(row);
    if (!(rowQty > 0)) continue;
    const thisCloseQty = round4(Math.min(rowQty, remainingToClose));
    const isLastFill = i === rows.length - 1 || remainingToClose - thisCloseQty <= 0.0001;
    const exitFeePortion =
      opts.exitFee == null
        ? null
        : isLastFill
          ? round2(opts.exitFee - allocatedExitFee)
          : round2(opts.exitFee * (thisCloseQty / opts.closeQuantity));
    if (typeof exitFeePortion === "number") {
      allocatedExitFee = round2(allocatedExitFee + exitFeePortion);
    }

    await closeSinglePosition({
      supabase: opts.supabase,
      userId: opts.userId,
      positionId: row.id,
      exitPrice: opts.exitPrice,
      exitFee: exitFeePortion,
      exitReason: opts.exitReason,
      closeQuantity: thisCloseQty,
    });
    remainingToClose = round4(remainingToClose - thisCloseQty);
    closedCount += 1;
  }

  return {
    mode: Math.abs(opts.closeQuantity - totalQty) <= 0.0001 ? ("full" as const) : ("partial" as const),
    closed_count: closedCount,
    closed_quantity: round4(opts.closeQuantity),
    remaining_quantity: round4(Math.max(0, totalQty - opts.closeQuantity)),
  };
}
