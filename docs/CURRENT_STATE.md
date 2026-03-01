# Current State

## Stable Working Features
The following are already built and working:

### Auth
- Supabase login/signup flow works

### Data
- Polygon daily bars integrated
- OHLCV stored in `price_bars`
- SPY regime calculation works
- Daily scan uses cached results from `daily_scans`

### Screener
- Reads latest scan from `daily_scans`
- Shows signal, confidence, entry, stop
- Filter chips exist
- Accordion details exist
- "Why" loads explanation from `/api/why`
- "Calc size" works
- "Open" creates editable trade ticket
- "Save to portfolio" works

### Portfolio
- Multiple portfolios supported
- Default portfolio used for sizing
- Open position workflow works
- Close position flow works

### Explainability
- `reason_summary` and `reason_json` stored on scan rows
- `/api/why` fetches explanation on demand

## Current Important Routes
- `/auth`
- `/screener`
- `/portfolio`

API routes:
- `/api/ingest-polygon`
- `/api/regime`
- `/api/scan`
- `/api/why`
- `/api/position-size`
- `/api/positions/add`

## Known Product Decisions
- Polygon is the price source of truth
- BUY is intentionally strict
- Regime can downgrade BUY to WATCH
- UI is clean light, not dark
- BUY should appear near the top even if WATCH has higher raw confidence
- Product is educational as well as functional

## Known Technical Snags From Earlier Work
- Tailwind v4 pipeline must stay correct
- If port changes from 3000 to 3001, browser tabs can fail with fetch errors
- New API routes often require dev server restart
- Ingest alone does not update screener. Scan must be rerun because `daily_scans` is cached output
- `screener/page.tsx` must stay server-side. A client-only wrapper version caused architecture drift
- Explainability works best via `/api/why` on demand

## Current UI Status
- Screener layout has been refactored toward compact rows + accordion details
- Latest active polish area is screener row spacing / button layout / compactness
- Goal is to remove horizontal scroll and make rows feel platform-like

## Immediate Next Priority
1. Finish screener UX polish
2. Add closed positions history
3. Add strategy/playbook learning page
4. Add ticker detail page later
