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

## Pending (need dUSDC)

- [ ] Direct Predict mint (`smoke:direct --execute`)
- [ ] Range / Breakout / Ladder notes via router
- [ ] Redeem (settled or early-exit)

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
