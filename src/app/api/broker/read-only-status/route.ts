import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getBrokerReadOnlySnapshot } from "@/lib/broker/read_only_sync";
import { getOrRepairDefaultPortfolio } from "@/lib/get_or_repair_default_portfolio";
import {
  persistBrokerSnapshot,
  reconcileBrokerWithPortfolio,
} from "@/lib/broker/persistence";

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    const code = obj.code ? String(obj.code) : null;
    const message = obj.message ? String(obj.message) : JSON.stringify(obj);
    return code ? `${code}: ${message}` : message;
  }
  return "Failed to persist broker snapshot";
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) =>
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            ),
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const snapshot = await getBrokerReadOnlySnapshot();
    const defaultPortfolio = await getOrRepairDefaultPortfolio({
      supabase: supabase as any,
      user_id: user.id,
    });
    const reconciliation = await reconcileBrokerWithPortfolio({
      supabase: supabase as any,
      portfolio_id: String(defaultPortfolio?.id ?? ""),
      broker_positions: snapshot.positions,
    });

    let persistence: {
      ok: boolean;
      key: string | null;
      updated_at: string | null;
      error: string | null;
    } = {
      ok: false,
      key: null,
      updated_at: null,
      error: null,
    };
    try {
      const saved = await persistBrokerSnapshot({
        supabase: supabase as any,
        user_id: user.id,
        snapshot,
        reconciliation,
      });
      persistence = {
        ok: true,
        key: saved.key,
        updated_at: saved.updated_at,
        error: null,
      };
    } catch (e: unknown) {
      persistence = {
        ok: false,
        key: null,
        updated_at: null,
        error: errMessage(e),
      };
    }

    return NextResponse.json({
      ok: snapshot.ok,
      user_id: user.id,
      provider: snapshot.provider,
      mode: snapshot.mode,
      configured: snapshot.configured,
      auth_ok: snapshot.auth_ok,
      connection_ok: snapshot.connection_ok,
      positions_count: snapshot.positions_count,
      warnings: snapshot.warnings,
      errors: snapshot.errors,
      broker: snapshot,
      portfolio: {
        default_portfolio_id: defaultPortfolio?.id ?? null,
      },
      reconciliation,
      persistence,
      safeguards: {
        execution_enabled: false,
        read_only_only: true,
        scanner_influence: false,
        strategy_influence: false,
        note: "Phase 1 broker integration is read-only. Execution remains disabled.",
      },
      rollout: {
        phase_1: "account/positions sync (read-only)",
        phase_2: "paper execution module",
        phase_3: "live execution module",
      },
    });
  } catch (e: unknown) {
    const error =
      e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
