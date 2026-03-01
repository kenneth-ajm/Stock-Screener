"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export default function AuthPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/screener";

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) return;
      if (data.session) router.replace(nextPath);
    });
  }, [supabase, router, nextPath]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMsg("Please enter your email.");
      return;
    }
    if (!password) {
      setMsg("Please enter your password.");
      return;
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;

        // If confirmations are enabled, session can be null
        if (!data.session) {
          setMsg(
            "Account created. If email confirmation is enabled, confirm your email then log in."
          );
          setMode("login");
        } else {
          router.replace(nextPath);
          window.location.assign(nextPath);
          return;
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;

        if (!data.session) {
          throw new Error(
            "Login succeeded but no session returned. Check Supabase email confirmation settings."
          );
        }

        router.replace(nextPath);
        window.location.assign(nextPath);
        return;
      }
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-page">
      <div className="mx-auto max-w-md">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <div className="text-3xl font-semibold tracking-tight">
              Stock Screener
            </div>
            <Badge variant="neutral">v1</Badge>
          </div>
          <div className="mt-2 text-sm muted">
            A clean, long-only daily screener with portfolios, regime filter, and
            strict BUY signals.
          </div>
        </div>

        <Card>
          <CardHeader
            title={mode === "login" ? "Log in" : "Create account"}
            subtitle={
              mode === "login"
                ? "Sign in to view your screener and portfolios."
                : "Create a separate login for independent preferences and capital."
            }
            right={
              mode === "login" ? (
                <Badge variant="neutral">Existing user</Badge>
              ) : (
                <Badge variant="neutral">New user</Badge>
              )
            }
          />
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
                <div className="text-xs muted">
                  Minimum 6 characters (dev-friendly).
                </div>
              </div>

              {msg ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
                  {msg}
                </div>
              ) : null}

              <Button
                type="submit"
                variant="primary"
                disabled={loading}
                className="w-full"
              >
                {loading
                  ? mode === "login"
                    ? "Logging in..."
                    : "Creating account..."
                  : mode === "login"
                  ? "Log in"
                  : "Create account"}
              </Button>

              <div className="flex items-center justify-between pt-2 text-sm">
                {mode === "login" ? (
                  <button
                    type="button"
                    className="underline muted"
                    onClick={() => {
                      setMsg(null);
                      setMode("signup");
                    }}
                  >
                    Need an account? Sign up
                  </button>
                ) : (
                  <button
                    type="button"
                    className="underline muted"
                    onClick={() => {
                      setMsg(null);
                      setMode("login");
                    }}
                  >
                    Already have an account? Log in
                  </button>
                )}

                <a href="/" className="underline muted">
                  Home
                </a>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 text-xs muted">
          Tip: Create separate portfolios for different budgets and “journeys”
          (e.g., Swing 2026, Trend Holds, 10k Challenge).
        </div>
      </div>
    </div>
  );
}
