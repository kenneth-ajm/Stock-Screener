"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSearchParams, useRouter } from "next/navigation";

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
    // If already logged in, jump straight to screener
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error("getSession error:", error);
        return;
      }
      if (data.session) router.replace(nextPath);
    });
  }, [supabase, router, nextPath]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const trimmedEmail = email.trim();

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });

        if (error) throw error;

        // In dev, if email confirmations are ON, user may need to confirm email
        // data.user can exist but data.session may be null
        if (!data.session) {
          setMsg(
            "Signup successful. If email confirmation is enabled in Supabase, please confirm your email before logging in."
          );
        } else {
          setMsg("Signup successful. You are logged in.");
          // If already logged in, go to screener
          router.replace(nextPath);
          window.location.assign(nextPath); // fallback
          return;
        }

        setMode("login");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        if (error) throw error;

        if (!data.session) {
          throw new Error(
            "Login did not return a session. Check Supabase Auth settings (email confirmation may be required)."
          );
        }

        // Primary navigation
        router.replace(nextPath);
        // Fallback navigation (fixes “nothing happens” cases)
        window.location.assign(nextPath);
        return;
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setMsg(err?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white/50 backdrop-blur p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">
          {mode === "login" ? "Log in" : "Create account"}
        </h1>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <input
              className="w-full rounded-xl border px-3 py-2 bg-white"
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
              className="w-full rounded-xl border px-3 py-2 bg-white"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {msg && (
            <div className="rounded-xl border px-3 py-2 text-sm bg-white">
              {msg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-black text-white py-2 font-medium disabled:opacity-60"
          >
            {loading
              ? mode === "login"
                ? "Logging in..."
                : "Creating account..."
              : mode === "login"
              ? "Log in"
              : "Create account"}
          </button>
        </form>

        <div className="mt-4 text-sm">
          {mode === "login" ? (
            <button
              className="underline"
              onClick={() => {
                setMsg(null);
                setMode("signup");
              }}
              type="button"
            >
              Need an account? Sign up
            </button>
          ) : (
            <button
              className="underline"
              onClick={() => {
                setMsg(null);
                setMode("login");
              }}
              type="button"
            >
              Already have an account? Log in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}