"use client";

import { useMemo, useState } from "react";

type Portfolio = {
  id: string;
  name: string;
  account_currency: string;
  account_size: number;
  risk_per_trade: number;
  max_positions: number;
  is_default: boolean;
};

export default function PortfolioClient({
  initialPortfolios,
}: {
  initialPortfolios: Portfolio[];
}) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>(initialPortfolios);

  const defaultPortfolio = useMemo(
    () => portfolios.find((p) => p.is_default),
    [portfolios]
  );

  const [name, setName] = useState("");
  const [accountSize, setAccountSize] = useState("11000");
  const [riskPerTrade, setRiskPerTrade] = useState("0.005");
  const [maxPositions, setMaxPositions] = useState("5");
  const [currency, setCurrency] = useState("USD");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createPortfolio() {
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          account_currency: currency,
          account_size: Number(accountSize),
          risk_per_trade: Number(riskPerTrade),
          max_positions: Number(maxPositions),
        }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Create failed");

      setPortfolios((prev) => [...prev, json.portfolio]);
      setName("");
      setMsg("Portfolio created.");
    } catch (e: any) {
      setMsg(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function setDefault(portfolioId: string) {
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio/set-default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Set default failed");

      setPortfolios((prev) =>
        prev.map((p) => ({ ...p, is_default: p.id === portfolioId }))
      );
      setMsg("Default portfolio updated.");
    } catch (e: any) {
      setMsg(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border p-4 bg-white/50">
        <div className="font-medium">Current default</div>
        <div className="mt-2 text-sm">
          {defaultPortfolio ? (
            <>
              <div>
                <span className="font-semibold">{defaultPortfolio.name}</span>{" "}
                <span className="text-muted-foreground">
                  ({defaultPortfolio.account_currency}{" "}
                  {Number(defaultPortfolio.account_size).toFixed(0)})
                </span>
              </div>
              <div className="text-muted-foreground">
                Risk/trade: {defaultPortfolio.risk_per_trade} | Max positions:{" "}
                {defaultPortfolio.max_positions}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">No default portfolio found.</div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border p-4 bg-white/50">
        <div className="font-medium">Your portfolios</div>

        <div className="mt-3 space-y-2">
          {portfolios.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl border bg-white p-3"
            >
              <div>
                <div className="font-semibold">
                  {p.name} {p.is_default ? "✅" : ""}
                </div>
                <div className="text-sm text-muted-foreground">
                  {p.account_currency} {Number(p.account_size).toFixed(0)} | risk{" "}
                  {p.risk_per_trade} | max {p.max_positions}
                </div>
              </div>

              <button
                disabled={loading || p.is_default}
                onClick={() => setDefault(p.id)}
                className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50"
              >
                Set default
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 border-t pt-4">
          <div className="font-medium">Create a new portfolio</div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Name</label>
              <input
                className="w-full rounded-xl border px-3 py-2 bg-white"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Swing 2026, Trend Holds, 10k Challenge"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Currency</label>
              <input
                className="w-full rounded-xl border px-3 py-2 bg-white"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                placeholder="USD"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Account size</label>
              <input
                className="w-full rounded-xl border px-3 py-2 bg-white"
                value={accountSize}
                onChange={(e) => setAccountSize(e.target.value)}
                placeholder="11000"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Risk per trade</label>
              <input
                className="w-full rounded-xl border px-3 py-2 bg-white"
                value={riskPerTrade}
                onChange={(e) => setRiskPerTrade(e.target.value)}
                placeholder="0.005"
              />
              <div className="text-xs text-muted-foreground">
                Example: 0.005 = 0.5%
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Max positions</label>
              <input
                className="w-full rounded-xl border px-3 py-2 bg-white"
                value={maxPositions}
                onChange={(e) => setMaxPositions(e.target.value)}
                placeholder="5"
              />
            </div>
          </div>

          <button
            disabled={loading}
            onClick={createPortfolio}
            className="mt-4 rounded-xl bg-black text-white px-4 py-2 disabled:opacity-60"
          >
            {loading ? "Working..." : "Create portfolio"}
          </button>

          {msg && (
            <div className="mt-3 rounded-xl border px-3 py-2 text-sm bg-white">
              {msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}