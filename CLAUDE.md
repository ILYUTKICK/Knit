# CLAUDE.md

Guidance for working in this repo. Keep it accurate — update it when commands or architecture change.

## What Knit is

Composable structured-note router on **DeepBook Predict** (Sui), built for Sui Overflow 2026.
Knit bundles several Predict legs (binary / range) into one `NoteReceipt` — a composable token
minted in a single atomic PTB. Three retail templates: **Range** (in a corridor), **Breakout**
(big move either way), **Ladder** (the higher the more it pays).

Positioning: **composable structured-product**, demoed via one-tap retail UX. Knit is a
*product* (e2e mint→redeem), not a vault — staying a product avoids the problem-statement's
simulation requirement.

## Layout

- `move/knit/sources/knit.move` — Move router: `create_range_note`, `create_breakout_note`,
  `create_ladder_note`, `redeem_note`, `create_registry`. Depends on the Predict package
  (testnet branch `predict-testnet-4-16`).
- `packages/core/src/` — TS core:
  - `config.ts` — testnet addresses (Predict package/object/registry, dUSDC type)
  - `templates.ts` — note definitions, `payoffAt`, `exactMaxPayout`, unit helpers
  - `transactions.ts` — PTB builders (`buildDirectMintNoteTx`, `buildKnit*NoteTx`, `buildQuoteInspectTx`)
  - `predict-client.ts` — minimal client for the public Predict server
- `scripts/` — `smoke-direct.ts` (direct Predict mint/quote), `save-deployment.ts` (capture deploy IDs)
- `apps/web/` — static HTML prototype (no wallet wiring yet)
- `docs/` — track-fit argument, phase-0 smoke status, qty→payout verification

## Commands

```bash
npm run core:test                      # TS unit tests (templates/payoff)
npm run web:check                      # syntax-check apps/web/src/app.js
cd move/knit && /Users/ilyutkinn/.local/bin/sui move build
npm run smoke:direct -- --range-check  # devInspect quotes (binary + range), no funds needed
npm run smoke:direct -- --execute      # live deposit + predict::mint (needs SUI + dUSDC)
npm run deploy:save -- --publish <digest> [--registry <digest>]   # capture deploy IDs
```

`sui` lives at `/Users/ilyutkinn/.local/bin/sui`. Active testnet address:
`0xf424d07e6a6482b591466fdc8f62c388735ac1e84969eb8d1e80048d6881637a`.

## Conventions & gotchas (read before changing on-chain or PTB code)

- **`NoteReceipt has key, store` and `create_*_note` RETURN it** (don't self-transfer). This is
  the composability thesis — PTB callers must capture the returned object and `transferObjects`
  it (or chain it). Don't revert this to a self-transfer.
- **Fresh `PredictManager` per note.** `redeem_note` computes payout as
  `balance_after - balance_before`. A shared manager holding other funds corrupts that delta.
  Never reuse one manager across notes for router flows.
- **`quantity` is in payout base-units** (dUSDC has 6 decimals). Minting `q` contracts pays `q`
  base units (= `q/1e6` dUSDC) if ITM. `predict::get_trade_amounts` returns
  `(mint_cost, redeem_now_value)`, **NOT** max payout. Frontend max-payout must come from
  `quantity` (see `docs/qty-payout-verification.md`).
- **Predict mint/mint_range take `MarketKey`/`RangeKey`, not raw strikes.** Build keys via
  `market_key::new` / `range_key::new` with the oracle's real `expiry` (from `/oracles/:id/state`).
- **Mint only while oracle is `Active`; redeem after `Settled` (or early-exit while `Active`).**
- Amounts are `u64` base units on-chain — no floats.
- `.knit-smoke.json` and `.knit-deployment.*.json` are gitignored (local state, not committed).

## Testnet config (provisional, swaps on mainnet day-one)

Predict package `0xf5ea2b37…785138`, object `0xc8736204…38028a`, registry `0x43af14fe…2a6e64`.
Quote: `0xe9504008…ba73e1a::dusdc::DUSDC` (request via https://tally.so/r/Xx102L).
Public server: `https://predict-server.testnet.mystenlabs.com`.
