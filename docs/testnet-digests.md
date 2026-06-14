# Testnet digests — on-chain proof trail

DeepBook Predict testnet (`predict-testnet-4-16`). Address `0xf424d07e6a6482b591466fdc8f62c388735ac1e84969eb8d1e80048d6881637a`.

## Knit router deployment (Phase 3)

| What | Value |
|---|---|
| Publish digest | `9kQniRuC9vasCX5Zd23rgb3QQ7fqYfUfeLDmcea53s3r` |
| **packageId** | `0xf5b66db021ad7ee7cea7d3f577117bae358e5aded21161076636bdc75f551ad0` |
| upgradeCap | `0x974fa284ca9978c6f1a045feb9249ad5c952d8b0c3dcc6e7152f77db5d027661` |
| Registry digest | `AVfzjzT5LUE5ALEB17VJecMgWCVEP6qxAnQcweJj26rA` |
| **registryId** (shared) | `0x83eedf91118eebc29b62cdd19481f65ab6d9f5b4229bf2206ea3fdfa03848091` |
| Quote type | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC` |
| fee_bps | `0` (MVP) |

Knit is **live on testnet**. IDs are also in `.knit-deployment.testnet.json` (gitignored local state).

## Direct Predict mint (Phase 2)

First live end-to-end proof: `create_manager` → `predict_manager::deposit` → `predict::mint`
against the live DeepBook Predict testnet. `npm run smoke:direct -- --execute`.

| What | Value |
|---|---|
| Manager create digest | `3SVwyP9sevv7f9uz3DzFQgA6iM4j3WUdbEA1fSkBRXUy` |
| PredictManager | `0xb5e4d0985f1f9dcf64637dea3b6622767d4ac02d866f673663f75a7621c028cb` |
| **Mint digest** | `9iCYmqSMrnKrbGV8pa4KEGoEJDtc9UHiyV4ethGeDoh` (success) |
| Oracle | `0x18b5b4676255d4357833d9d2be02d4b2a5a15b02c07b2c7828a80bbf87c63d6c` |
| Binary leg | up @ 64294, q = 1 dUSDC unit; mint cost ≈ 0.5114 dUSDC |

## Structured notes via Knit router (Phase 4)

Each note = a fresh `PredictManager` + `knit::create_*_note` minting all legs in ONE
atomic PTB, emitting `NoteCreated`, returning a composable `NoteReceipt`.
`npm run smoke:knit -- --template <t> --execute`.

| Template | Note digest | NoteReceipt | Manager | Legs / mints in PTB | cost / max payout |
|---|---|---|---|---|---|
| range | `5yZXrAcRTV4sKtE1fcpERboVimvscuiA1xBUrYce3mCv` | `0xc0a6e0084537cfb74900eab9d78a1fbc59e657f8d392879411b80fe5372a2b73` | `0x522d2dcc8888cb97cd41f606423d8d636f850e523cf0b3f3a2bef05a4a494dcd` | 1 range | 0.0295 / 1 dUSDC |
| breakout | `3psDNEbudUA5gbPWcic2fZVJFUGjARFGE5xWbM3qYYAP` | `0xdc9ce63de0f7d77f62a3b43c69114453c28cee1cbaca40a7967eee61997914a5` | `0x8fba320d7d805fcd1921b3dec92503084e76ff46b64ad45244293a2b58c4a716` | **2 binary** | 0.9954 / 1 dUSDC |
| ladder | `Ets4dzKNeqeYMLRNNXWToAmDtkBqZKqrkUt6rYV4t54u` | `0x3d6e9694e32ca477b2bab2176b9e71712a53f3d655b25d015593d5c4fcd24a9e` | `0x7af511ba56bef59f7c850cad59506eafe9e25e7e79d6c174a88228e4e99d5a2e` | **3 binary** | 1.6389 / 3 dUSDC |

Breakout (2) and ladder (3) mints land atomically in a single transaction — the
"powered by DeepBook" composition story.

## Redeem (Phase 5) — full e2e closed

`knit::redeem_note` redeems every leg, measures the manager balance delta, withdraws
exactly that payout, emits `NoteRedeemed`. `npm run smoke:redeem -- --template <t>`.

Both redeem paths exercised — early exit (Active) and settled price (after expiry):

| Note | Redeem digest | Path | Payout |
|---|---|---|---|
| range (`0xc0a6e008…`) | `FfXJVmbSv5t4RimmfNEcG3px4p79X9pVfw1xn1QFoBRf` | early exit (oracle Active, live quote) | 0.007835 dUSDC |
| breakout (`0xdc9ce63d…`) | `DEWsSSRd1Axfe91ojd9bz57rLonKobDweJUQkQkzKxuJ` | **settled** (after expiry, settled price) | **1.000000 dUSDC (full — won)** |

**Full end-to-end is proven on testnet:** deposit dUSDC → mint a structured note in one
atomic PTB → redeem → dUSDC back to the wallet. The breakout strangle settled in-the-money
(BTC outside the corridor) and paid its full max payout. The ladder note remains open.

## Live composability — knit_demo (Phase 6, live)

An INDEPENDENT package (`knit_demo`) takes a real `NoteReceipt` by value, reads its public
getters on-chain, custodies it, and returns it — proving Knit notes are holdable, inspectable,
composable collateral for external Sui DeFi (the named problem-statement criterion), live and
not just in the unit test. `npm run smoke:collateral -- --template ladder`.

| What | Value |
|---|---|
| demo packageId | `0x4ad0f8219db68dbb02b3b2e8514010756ea2d1d6f7b84e1990b940076453c2df` |
| publish digest | `62HHVmbATr8gSuu5Utztzg5jkSb6duu3UJpGk6ZZ4BhK` |
| vault | `0xf647e9cee4b0d97fa528f8401a101484b884450bda6115547c8c43be9f665c1d` |
| **pledge digest** | `96BajoMkMuFW2R4zeDVDw38twsum2Tnnefco9wM2a71Y` (NotePledged read max_payout 3 dUSDC, template ladder) |
| **release digest** | `FkVd6hSLYtfU4MGPKv7f7gmnNChotTrVqaFBAHuZPZ8Q` |
| note pledged | ladder `0x3d6e9694…fcd24a9e` (returned to owner) |

## Reproducing the publish (dependency published-at)

The `predict-testnet-4-16` branch ships predict/deepbook/token as dev sources **without
`published-at`**, so a fresh `sui client publish` reports "unpublished dependencies". To
link against the LIVE deployment (not republish copies), the three dependency manifests
need `published-at` + their on-chain addresses set. On-chain addresses (from the Predict
package linkage table):

| Package | named address (original id) | published-at (latest) |
|---|---|---|
| deepbook_predict | `0xf5ea2b37…785138` | `0xf5ea2b37…785138` (v1) |
| deepbook | `0xfb28c4cb…6982` | `0x74cd5657…77c8` (v19) |
| token | `0x36dbef86…58a8` | `0x36dbef86…58a8` (v1) |

Published with `--allow-dirty --skip-dependency-verification` (cached dep manifests were
patched; on-chain deepbook v19 bytecode differs from the pinned source commit, so dep
verification is skipped). NEVER use `--with-unpublished-dependencies` — it would republish
Predict's modules under a new id and break the integration.
