# Phase 0 Smoke Status

This note tracks the first technical gate from `knit-build-plan.md`: prove Knit can talk to live DeepBook Predict testnet objects before publishing the Knit router.

## Current State

- Sui CLI is installed at `/Users/ilyutkinn/.local/bin/sui`.
- Active Sui env is `testnet`.
- Active testnet address is `0xbc873ba5271810e3ae49616029d958d215cdba9c101e42f78c9de484060f260e`.
- `move/knit` builds successfully.
- `npm run smoke:direct -- --range-check` successfully picks an active future BTC oracle and gets both binary and range quotes through `devInspect`.

The live mint step is waiting on faucet funding:

- SUI gas: https://faucet.sui.io/?address=0xbc873ba5271810e3ae49616029d958d215cdba9c101e42f78c9de484060f260e
- dUSDC: https://tally.so/r/Xx102L

## Commands

```bash
npm install
npm run core:test
npm run web:check
cd move/knit && /Users/ilyutkinn/.local/bin/sui move build
npm run smoke:direct -- --range-check
```

After SUI and dUSDC arrive:

```bash
npm run smoke:direct -- --execute
```

## Expected Dry-Run Shape

The smoke script should print:

- selected network and address
- selected BTC oracle, expiry, spot, strike
- `Binary quote: success`
- with `--range-check`, `Range quote: success`
- missing funding hints, until the wallet has SUI and dUSDC

`--execute` creates and caches a `PredictManager` in `.knit-smoke.json`, then executes one direct `deposit + predict::mint` transaction. The cache file is intentionally ignored by git.
