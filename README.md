# Knit

**Composable structured notes on DeepBook Predict (Sui).**

Knit bundles several DeepBook Predict legs — binary positions and vertical ranges — into a
single structured note minted in **one atomic PTB**, and hands the user a composable
`NoteReceipt` object. Three retail products (Range, Breakout, Ladder) abstract strikes and
greeks into a payoff diagram anyone can read.

Built for Sui Overflow 2026 · Special — DeepBook track.

## Why this is different

On DeepBook Predict, positions are **not objects** — they live as rows in a shared
`PredictManager` table; you cannot hold, transfer, or hand them to another contract. Knit
wraps a bundle of positions into one `NoteReceipt` (`has key, store`) — the first
**holdable, transferable, composable** representation of a Predict position set. That is the
"tokenized share token on top of `PredictManager`" the problem statement explicitly asks for,
and it is what lets a structured note plug into the wider Sui DeFi stack (margin collateral,
LP, structured wrappers) on mainnet day-one.

## The three products

- **Range — "stay in range":** one `mint_range` leg. Pays if settle lands in `(low, high]`.
- **Breakout — "big move":** two binary legs (`up @ high` + `down @ low`). A digital strangle —
  pays if price breaks out either side.
- **Ladder — "higher = more":** three ascending `up` binaries. A capped digital call-spread —
  `0 → q → 2q → 3q` as strikes are crossed.

Every note's payoff is `Σ` of its legs, so the payoff chart and pricing are template-agnostic.

## Live on testnet

Knit is deployed and proven end-to-end on Sui testnet against the live DeepBook Predict
deployment (`predict-testnet-4-16`). Full digest trail in [docs/testnet-digests.md](docs/testnet-digests.md).

```
Knit package    : 0xf5b66db021ad7ee7cea7d3f577117bae358e5aded21161076636bdc75f551ad0
Knit registry   : 0x83eedf91118eebc29b62cdd19481f65ab6d9f5b4229bf2206ea3fdfa03848091
Collateral demo : 0x4ad0f8219db68dbb02b3b2e8514010756ea2d1d6f7b84e1990b940076453c2df
Predict package : 0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138
Quote (dUSDC)   : 0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
```

What has been proven on-chain:

- **Direct mint** against live Predict (`deposit` + `predict::mint`).
- **Router notes** — Range, Breakout (2 mints), Ladder (3 mints), each in one atomic PTB.
- **Redeem** both ways — early exit (oracle `Active`) and settled price (after expiry; the
  breakout strangle settled in-the-money and paid its full 1 dUSDC).
- **Composability, live** — an independent package (`knit_demo`) pledges a real `NoteReceipt`
  as collateral, reads its getters on-chain, and returns it.

## How it works

```
Frontend (apps/web)                 Knit Move package (move/knit)
  • pick template, slide strikes      • create_range_note / create_breakout_note
  • live devInspect quote               / create_ladder_note  -> returns NoteReceipt
  • one-tap Create (wallet PTB)       • redeem_note (balance-delta payout, NoteRedeemed)
        │                             • NoteRegistry, NoteCreated events
        ▼                                     │ on-chain
  DeepBook Predict testnet  ◄─────────────────┘
  Predict / PredictManager / OracleSVI / Vault
```

- `create_*_note` charges the Knit fee, deposits the payment into the user's `PredictManager`,
  mints every leg via `predict::mint` / `predict::mint_range` in the same PTB, refunds the
  unused quote, and **returns** the `NoteReceipt` so a PTB can chain it (transfer, pledge, …).
- `redeem_note` redeems every leg, measures the manager balance delta, withdraws exactly that
  payout, and burns the receipt. The delta approach is robust even when one manager is reused
  across notes (the canonical per-user pattern).
- `knit_demo::collateral_vault` is an independent package proving the note is composable
  collateral.

## Repo layout

- `move/knit` — the router package (`knit.move`).
- `move/knit_demo` — composability demo: external package consuming `NoteReceipt`.
- `packages/core` — TypeScript core: templates/payoff, PTB builders, Predict server client.
- `scripts` — smoke tooling (`smoke:direct`, `smoke:knit`, `smoke:redeem`, `smoke:collateral`, `deploy:save`).
- `apps/web` — functional vanilla-JS frontend (live oracle, real quotes, wallet mint).
- `docs` — track fit, qty→payout verification, on-chain digest trail.

## Quickstart

```bash
npm install

# unit tests + checks
npm run core:test
npm run web:check
cd move/knit && sui move build
cd move/knit_demo && sui move test --allow-dirty   # cross-package composability test

# read-only smoke (no funds needed): pick a live oracle and quote via devInspect
npm run smoke:direct -- --range-check
npm run smoke:knit -- --template range            # also: breakout, ladder
```

With SUI gas and dUSDC ([request dUSDC](https://tally.so/r/Xx102L)):

```bash
npm run smoke:direct -- --execute                       # first live mint
npm run smoke:knit -- --template breakout --execute     # note via router
npm run smoke:redeem -- --template breakout             # redeem
npm run smoke:collateral -- --template ladder           # pledge note as collateral
```

### Frontend

Wallets require http(s), so serve over localhost:

```bash
npm run web:serve     # http://localhost:8000
```

Open it, connect a Sui wallet (e.g. Slush) on testnet, slide the strikes (the cost is a live
`devInspect` quote), and tap **Create** to mint a note through the router.

## Stack

- **Move** — `knit` package (depends on Predict `predict-testnet-4-16`).
- **SDK/PTB** — `@mysten/sui` (Transaction), `@mysten/wallet-standard`.
- **Frontend** — vanilla JS + canvas payoff chart, ESM from CDN, no build step.

## Notes for builders

`predict::mint` / `mint_range` take `MarketKey` / `RangeKey` (built via `market_key::new` /
`range_key::new` with the oracle's real `expiry`), not raw strikes. `quantity` is in payout
base units (`q` contracts pay `q` base units = `q / 1e6` dUSDC if in-the-money);
`get_trade_amounts` returns `(mint_cost, redeem_now)`, not the max payout — see
[docs/qty-payout-verification.md](docs/qty-payout-verification.md).

The `predict-testnet-4-16` dependency ships without `published-at`; see
[docs/testnet-digests.md](docs/testnet-digests.md) for how the router was published against
the live deployment.

## Sources

- DeepBook Predict (`predict.move`, branch `predict-testnet-4-16`):
  https://github.com/MystenLabs/deepbookv3/tree/predict-testnet-4-16/packages/predict
- Public Predict server: https://predict-server.testnet.mystenlabs.com
- DeepBook Predict docs: https://docs.sui.io/onchain-finance/deepbook-predict/
