# AGENTS.md

## Purpose

This document defines the operational rules for AI agents working on the Stock-Screener repository.

Agents include:
- Codex
- ChatGPT
- automated CI agents
- future AI code assistants

Agents must follow these rules to avoid damaging the trading system.

--------------------------------

# System Overview

Stock-Screener is a **single-user web-based swing trading terminal**.

Purpose:

Unify:

- stock scanning
- trade planning
- risk management
- portfolio tracking
- trade journaling
- strategy validation

The system is designed to behave like a **calm trading cockpit**, not a signal spam engine.

Signals must always be:

- explainable
- risk-aware
- structured

--------------------------------

# Non-Negotiable Platform Rules

These must never be violated.

Trading Scope:

US stocks only  
Daily timeframe only  
Long-only strategies

No intraday logic.  
No short selling.

--------------------------------

# Architecture

High-level pipeline:

price_bars  
↓  
indicator calculations  
↓  
strategy filters  
↓  
signal generation  
↓  
daily_scans  
↓  
Ideas UI

Important:

UI must **never calculate trading signals directly**.

Signals are always generated server-side and cached.

--------------------------------

# Technology Stack

Frontend

Next.js (App Router)  
React  
TailwindCSS

Backend

TypeScript  
Next.js API routes

Database

Supabase (Postgres)

Hosting

Vercel serverless

Deployment flow:

git push → Vercel deploy

Local dev is not required.

--------------------------------

# Core Database Tables

price_bars

Daily OHLCV data from Polygon.

daily_scans

Generated signals.

portfolio_positions

Tracks open and closed trades.

universe_symbols

Defines scan universes.

--------------------------------

# Signal Structure

Every signal must contain:

symbol  
signal  
entry  
stop  
tp1  
tp2  
confidence  
rank  
reason_summary  
reason_json

Explainability is mandatory.

--------------------------------

# Strategies

Momentum Swing

Short breakout swings  
Holding period: 3–7 days

Trend Hold

Multi-week trend continuation

Sector Momentum

Industry leadership discovery.

--------------------------------

# Market Regime System

Market context is derived from:

SPY vs SMA200  
% stocks above SMA50  
% stocks above SMA200

Regimes:

STRONG  
MIXED  
WEAK

Signals may be downgraded during weak regimes.

--------------------------------

# Risk Model

Risk per trade:

≈ 2% account risk

Position sizing:

shares = risk / (entry − stop)

Stops based on:

support levels  
ATR  
maximum % rules

--------------------------------

# Broker Integration Safety

Broker integrations must follow strict isolation.

Architecture:

Scanner Engine  
↓  
Signal Generation  
↓  
Execution Decision Layer  
↓  
Trade Ticket  
↓  
Broker Connector

Broker APIs must:

• run server-side only  
• never influence signal logic  
• never expose keys to frontend

Deployment order:

1) account sync  
2) paper trading  
3) live execution

--------------------------------

# Development Rules for Agents

Agents must follow these constraints.

Never redesign the UI without explicit instruction.

Never rewrite the scanner engine.

Never modify database schema without approval.

Prefer additive improvements.

Never break these systems:

scanner logic  
portfolio risk math  
price ingestion  
database schema

--------------------------------

# Performance Philosophy

The system relies on **cached derived datasets**.

Heavy calculations must happen:

offline  
in background jobs  
during scan runs

UI must read cached results only.

--------------------------------

# Sector Momentum Notes

Sector Momentum depends on derived datasets:

market breadth  
sector strength  
industry group rankings

These must be computed from existing price_bars.

Agents must never trigger full raw data ingestion unless explicitly instructed.

--------------------------------

# Historical Backtest System

Backtesting reads historical rows from daily_scans.

Historical scan backfill must be handled carefully to avoid duplicate rows.

Agents should always:

prefer derived recomputation  
avoid massive re-ingestion

--------------------------------

# Safety Guidelines

Agents must:

avoid destructive migrations  
avoid deleting large datasets  
avoid rewriting historical price data  
avoid long-running background jobs unless requested

--------------------------------

# Codex Workflow

Typical development cycle:

ChatGPT → architecture decisions  
Codex → modify repo  
git push → Vercel deploy

Agents must always:

run build  
report changed files  
commit with clear messages  
push changes

--------------------------------

# Future System Expansion

Planned additions include:

sector strength dashboards  
industry group statistics  
market breadth monitoring  
Tiger Broker integration

Agents should implement these as **additive modules**, not core rewrites.
