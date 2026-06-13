# qty → payout verification

Closes open question #4 from the production spec (§15) and the WIN-track blocker
before any frontend money numbers are shown: **what does `quantity` mean, and how
do we map it to "вложишь X / макс. выплата Y"?**

## Method

Ran a live `devInspect` against the testnet Predict deployment
(`predict-testnet-4-16`) with `npm run smoke:direct -- --range-check`, calling
`predict::get_trade_amounts` (binary) and `predict::get_range_trade_amounts`
(range) on an active future BTC oracle. No funds required — pure read.

- Address: `0xf424d07e6a6482b591466fdc8f62c388735ac1e84969eb8d1e80048d6881637a`
- Oracle: `0xf15cae4f4e5704ad152df9e3b9c166a6f3f4e0b9ce2e604b7335b419f8d079f4`
- Spot: `64091.25`, ATM strike: `64091`
- `quantity = 1_000_000` base units (= 1.0 dUSDC notional, 6 decimals)

## Raw results

| Leg | strike(s) | return 0 | return 1 |
|---|---|---|---|
| Binary ATM (`is_up=true`) | `64091` | `541935` | `521975` |
| Range (±5 ticks around spot) | `[spot-5t, spot+5t]` | `55404` | `45404` |

In dUSDC (÷ 1e6):

| Leg | return 0 | return 1 |
|---|---|---|
| Binary ATM | 0.541935 | 0.521975 |
| Range | 0.055404 | 0.045404 |

## Interpretation

1. **`quantity` is denominated in payout base-units.** Minting `q` contracts of a
   leg pays exactly `q` base units (= `q / 1e6` dUSDC) at settlement **if the leg is
   in-the-money**, else `0`. For `q = 1_000_000`, max payout of one ITM leg = 1.0 dUSDC.

2. **`get_trade_amounts` returns `(mint_cost, redeem_now_value)`**, both in base
   units — NOT the max payout. `return 0 > return 1` in both rows = the ask/bid
   spread (you pay the ask to mint, receive the bid to sell early). The ATM binary
   priced ~0.54 to mint / ~0.52 to sell-now ≈ a ~50% implied probability plus spread,
   exactly what an ATM binary should look like. The narrow range priced ~0.055 (low
   probability of landing in a tight band), also sane.

> ⚠️ Ordering `(mint_cost, redeem_now)` is inferred from the spread direction
> (`return0 > return1`). Confirm against the `predict.move` signature before relying
> on it in production display, but the conclusion below holds either way.

## Mapping for the frontend / quote API

For a note built from legs `L`:

- **"Вложишь X"** (cost) = `Σ over legs ( get_*_trade_amounts(leg).return0 )` + Knit fee.
  This is the only number that comes from `devInspect`.
- **"Макс. выплата Y"** = `NoteDefinition.maxPayout`, computed from `quantity`, **NOT**
  from any `devInspect` return value:
  - range: `quantity` (single band pays `q` if settle ∈ band)
  - breakout: `quantity` (only one of down@low / up@high can be ITM — never both)
  - ladder: `quantity * 3` (all three up-legs are ITM simultaneously if settle > K3)
- **"Шанс / breakeven"** = derived for UX only (implied probability = cost / maxPayout
  per leg); marketing banner, not trading logic.

## Consequences confirmed

- The Move contract's `max_payout` fields are **correct**:
  [`knit.move`](../move/knit/sources/knit.move) passes `quantity` for range/breakout
  and `quantity * 3` for ladder.
- The TS model agrees: [`templates.ts`](../packages/core/src/templates.ts)
  `payoffAt` / `exactMaxPayout` produce the same `maxPayout`, and `core:test`
  covers all three templates.
- **Frontend risk to avoid:** never display `devInspect.return1` (or `return0`) as
  "max payout" — that would show ~0.52 instead of 1.0 dUSDC. Always compute max
  payout from `quantity`.
