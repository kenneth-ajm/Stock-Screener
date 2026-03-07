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
- `TIGER_PRIVATE_KEY` (required for RSA request signing)
- `TIGER_BASE_URL` (optional, defaults to Tiger OpenAPI base URL)
- `TIGER_ACCOUNT_ENDPOINT` (optional, defaults to `/gateway`)
- `TIGER_POSITIONS_ENDPOINT` (optional, defaults to `/gateway`)
- `TIGER_ACCOUNT_METHOD` (optional Tiger gateway method for account query, default `assets` with fallback candidates)
- `TIGER_POSITIONS_METHOD` (optional Tiger gateway method for positions query, default `positions` with fallback candidates)
- `TIGER_CHARSET` (optional, defaults to `UTF-8`)
- `TIGER_SIGN_TYPE` (optional, defaults to `RSA`)
- `TIGER_GATEWAY_VERSION` (optional, defaults to `1.0`)
- `TIGER_ACCESS_TOKEN` (optional compatibility fallback; not required for configured=true)

### `TIGER_PRIVATE_KEY` format notes

The connector accepts either:

- Full PEM key (`-----BEGIN RSA PRIVATE KEY----- ...`)
- Full PKCS#8 PEM key (`-----BEGIN PRIVATE KEY----- ...`)
- Raw base64 key body (no PEM wrapper)

Escaped newlines (`\\n`) are normalized automatically.

Signing notes:
- `sign_type=RSA` uses `RSA-SHA1` (Tiger gateway compatibility)
- `sign_type=RSA2` uses `RSA-SHA256`

Do not expose these via `NEXT_PUBLIC_*`.

## Endpoint

- `GET /api/broker/read-only-status`
  - Auth required
  - Returns connector mode, configured/auth/connection flags, read-only account/positions snapshot, reconciliation summary against internal open positions, persistence status, and safety metadata.
  - Persists a per-user snapshot to `system_status` with key format:
    - `broker_snapshot_last_run:<user_id>`

## Required DB Object

- `public.system_status` must exist for snapshot persistence.
- Migration file:
  - `docs/SQL/2026-03-07_system_status_broker_persistence.sql`

## Rollout Plan

1. Phase 1: Read-only account/position sync
2. Phase 2: Paper execution module
3. Phase 3: Live execution module
