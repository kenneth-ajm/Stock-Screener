"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export default function AuthClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      throw new Error(
        "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
      );
    }

    return createClient(url, anonKey);
  }, []);

  const nextPath = searchParams.get("next") || "/screener";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      if (!email.trim() || !password.trim()) {
        setMessage("Please enter email and password.");
        return;
      }

      if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setMessage(error.message);
          return;
        }

        if (data.session) {
          router.push(nextPath);
          router.refresh();
        } else {
          setMessage("Signed in but no session found. Please try again.");
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          setMessage(error.message);
          return;
        }

        if (data.session) {
          router.push(nextPath);
          router.refresh();
        } else {
          setMessage(
            "Signup successful. If email confirmation is enabled, check your inbox."
          );
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            Stock Screener
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in to scan, size, open, track, and close trades.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`rounded-full px-3 py-1 text-sm ${
                mode === "signin"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`rounded-full px-3 py-1 text-sm ${
                mode === "signup"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                type="password"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
            </div>

            {message ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {message}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? "Please wait…"
                : mode === "signin"
                ? "Sign in"
                : "Create account"}
            </button>

            <p className="pt-2 text-xs text-slate-500">
              Redirect after login:{" "}
              <span className="font-mono text-slate-700">{nextPath}</span>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}