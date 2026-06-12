# DeepBook Predict Track Fit

## Official Minimum Bar

Knit should be submitted as a user-facing structured-product app, not as a vault strategy.

That means the qualifying demo must prove:

1. Real DeepBook Predict testnet integration.
2. End-to-end product flow that judges can run:
   - get dUSDC
   - create or select a `PredictManager`
   - quote a note
   - mint every leg through DeepBook Predict
   - redeem the note
   - receive dUSDC payout
3. No vault-strategy claim unless we add simulation results.

The product path is stronger for a 7-day build because it avoids the simulation requirement while still showing multiple Predict primitives composed in one PTB.

## Why Knit Matches The Prompt

The statement asks for functional apps, services, vaults, bots, analytics, or structured products around DeepBook Predict. Knit is a structured-product frontend and router:

- Range Note maps to one `predict::mint_range` leg.
- Breakout Note maps to two binary `predict::mint` legs.
- Ladder Note maps to three binary `predict::mint` legs.
- The user sees a payoff shape instead of raw strikes and option-style language.
- Mint is atomic: deposit into `PredictManager`, then mint all legs in one PTB.

This is distinct from the canonical pro UI: Knit is consumer-friendly composition, not another trading terminal.

## What Not To Overclaim

- Do not pitch current MVP as a tokenized transferable note. In self-custody mode, `PredictManager` positions are redeemable only by the manager owner, so a transferable receipt would be misleading.
- Do not pitch current MVP as a vault. A vault would trigger the official "proper simulation result" requirement.
- Do not pitch live testnet composition with `deepbook_margin` or `iron_bank`. The statement says those are already live on mainnet, while Predict is live on testnet. That is a mainnet-day-one story unless a testnet deployment appears.

## Stretch That Fits The Idea Bank

After MVP:

1. Escrow-managed transferable notes:
   - Knit owns an escrow `PredictManager`.
   - User receives a transferable note object.
   - Redeem pays the note holder.
   - This is the right path for "portable structured products".

2. Settled-redeem keeper:
   - Watch `OracleSettled`.
   - Call `predict::redeem_permissionless` for settled positions.
   - Add optional tipping.

3. PLP + hedge vault:
   - Supply to `predict::supply`.
   - Buy OTM binary hedges.
   - Requires real simulation before submission as a vault.

## Demo Message

"DeepBook Predict gives programmable priced outcomes across strikes and ranges. Knit turns those primitives into retail structured notes: choose a payoff shape, see the payout graph, mint multiple Predict legs in one transaction, and redeem to dUSDC on testnet."
