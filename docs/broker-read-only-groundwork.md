# Broker Integration Phase 1 (Read-Only Groundwork)

This repository now includes a strict read-only broker connector foundation with live account/positions sync.

## Safety Boundaries

- Broker module is server-side only (`server-only` imports in broker services).
- No broker logic is used by scanner, strategy, or backtest engines.
- No trade execution is enabled.
- `placeOrder()` exists only as a guard and always throws.

## Environment Variables (server-side only)

- `BROKER_PROVIDER` (currently `tiger`)
- `TIGER_CLIENT_ID`
- `TIGER_ACCOUNT_ID`
- `TIGER_PRIVATE_KEY` (optional for future signed flows)
- `TIGER_ACCESS_TOKEN`
- `TIGER_BASE_URL` (optional, defaults to Tiger OpenAPI base URL)
- `TIGER_ACCOUNT_ENDPOINT` (optional, defaults to `/gateway`)
- `TIGER_POSITIONS_ENDPOINT` (optional, defaults to `/gateway`)

Do not expose these via `NEXT_PUBLIC_*`.

## Endpoint

- `GET /api/broker/read-only-status`
  - Auth required
  - Returns connector mode, configured/auth/connection flags, read-only account/positions snapshot, reconciliation summary against internal open positions, persistence status, and safety metadata.
  - Persists a per-user snapshot to `system_status` with key format:
    - `broker_snapshot_last_run:<user_id>`

## Rollout Plan

1. Phase 1: Read-only account/position sync
2. Phase 2: Paper execution module
3. Phase 3: Live execution module
