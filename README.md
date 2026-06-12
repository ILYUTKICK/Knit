# Knit

Knit — стартовый каркас для Sui Overflow 2026 / DeepBook Predict track: структурные ноты из нескольких Predict-ног, собранные в один атомарный PTB.

## Что уже собрано

- `move/knit` — Move router поверх DeepBook Predict:
  - `create_range_note`
  - `create_breakout_note`
  - `create_ladder_note`
  - `redeem_note`
  - `NoteReceipt` и `NoteCreated` / `NoteRedeemed` events
- `packages/core` — TS-core:
  - шаблоны нот и payoff-функции
  - билдеры PTB для прямого Predict smoke-test
  - билдеры PTB для Knit-router после деплоя Move package
  - минимальный клиент публичного Predict server
- `apps/web` — статический UX-прототип конструктора:
  - три шаблона
  - sliders по страйкам и notional
  - payoff canvas
  - демо-портфель
- `docs/deepbook-track-fit.md` — привязка Knit к официальному problem statement.

## Проверки

```bash
npm run core:test
npm run web:check
```

Обе проверки сейчас проходят. `sui` CLI на этой машине не установлен, поэтому `sui move build` пока не запускался.

## Открыть прототип

Открой в браузере:

```text
/Users/ilyutkinn/Desktop/Knit/apps/web/index.html
```

Это статический прототип без wallet-интеграции. Реальная подпись, zkLogin/Enoki и запросы к testnet идут следующим слоем.

## Важные поправки к production spec

1. `predict::mint` и `predict::mint_range` принимают `MarketKey` / `RangeKey`, а не raw strikes. TS direct-builder и Move-router собирают ключи через `market_key::new` и `range_key::new`.

2. `MarketKey` / `RangeKey` должны содержать настоящий `expiry` оракула. Для direct/quote PTB `expiryMs` надо брать из `/oracles/:oracle_id/state`.

3. `PredictManager` создается через `predict::create_manager`, который сразу шарит manager object. Поэтому лучше считать manager one-time setup транзакцией. Note mint PTB = `deposit + N x mint`, но не `create_manager + deposit + mint`.

4. В варианте A receipt не должен быть свободно переносимым. `PredictManager` редимится только владельцем manager, так что transferable note честно появляется только в escrow/NFT варианте B. Поэтому текущий `NoteReceipt` имеет `key`, но не `store`.

5. `redeem_note` снимает только дельту баланса manager: `balance_after - balance_before`. Это защищает от случайного `withdraw_all`, если в manager лежат другие средства.

6. По официальному problem statement Knit лучше подавать как structured-product app, а не vault. Vault-режим потребует simulation results. См. [docs/deepbook-track-fit.md](docs/deepbook-track-fit.md).

## Testnet config

```ts
Predict package  = 0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138
Predict registry = 0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64
Predict object   = 0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a
Quote DUSDC      = 0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
```

## Следующий живой e2e

1. Установить Sui CLI.
2. Проверить `sui move build` в `move/knit`.
3. Опубликовать `knit` на testnet.
4. Вызвать `knit::create_registry<DUSDC>(fee_bps)`.
5. Один раз создать `PredictManager` для demo wallet.
6. Подключить `packages/core/src/transactions.ts` к dAppKit/Enoki.
7. Сделать `devInspect` quote, затем live `create_*_note`.
8. На settled oracle прогнать `redeem_note` и показать DUSDC payout.

## Источники

- DeepBook Predict `predict.move`: https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict.move
- DeepBook Predict `predict_manager.move`: https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict_manager.move
- `MarketKey` / `RangeKey`: https://github.com/MystenLabs/deepbookv3/tree/predict-testnet-4-16/packages/predict/sources/market_key
- Public Predict server: https://predict-server.testnet.mystenlabs.com
