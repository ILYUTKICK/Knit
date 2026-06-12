import { Transaction } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { TESTNET_CONFIG, type KnitDeployment } from "./config.ts";
import type { NoteLeg } from "./templates.ts";

export type PredictContracts = {
  predictPackageId: string;
  predictObjectId: string;
  quoteType: string;
};

export type ManagerOracleInputs = {
  managerId: string;
  oracleId: string;
};

export type KeyedPredictInputs = ManagerOracleInputs & {
  expiryMs: bigint | number | string;
};

export type DirectMintParams = KeyedPredictInputs & {
  paymentCoinId: string;
  maxPayment: bigint | number | string;
  legs: readonly NoteLeg[];
  contracts?: PredictContracts;
};

export type KnitCreateParams = ManagerOracleInputs & {
  paymentCoinId: string;
  maxPayment: bigint | number | string;
  deployment: KnitDeployment;
  contracts?: PredictContracts;
};

export function buildCreateManagerTx(contracts = defaultContracts()) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${contracts.predictPackageId}::predict::create_manager`,
  });
  return tx;
}

export function buildDirectMintNoteTx(params: DirectMintParams) {
  const contracts = params.contracts ?? defaultContracts();
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.object(params.paymentCoinId), [u64(tx, params.maxPayment)]);

  tx.moveCall({
    target: `${contracts.predictPackageId}::predict_manager::deposit`,
    typeArguments: [contracts.quoteType],
    arguments: [tx.object(params.managerId), payment],
  });

  for (const leg of params.legs) {
    if (leg.kind === "range") {
      const key = tx.moveCall({
        target: `${contracts.predictPackageId}::range_key::new`,
        arguments: [
          tx.pure.id(params.oracleId),
          u64(tx, params.expiryMs),
          u64(tx, leg.lowerStrike),
          u64(tx, leg.higherStrike),
        ],
      });

      tx.moveCall({
        target: `${contracts.predictPackageId}::predict::mint_range`,
        typeArguments: [contracts.quoteType],
        arguments: [
          tx.object(contracts.predictObjectId),
          tx.object(params.managerId),
          tx.object(params.oracleId),
          key,
          u64(tx, leg.quantity),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
    } else {
      const key = tx.moveCall({
        target: `${contracts.predictPackageId}::market_key::new`,
        arguments: [
          tx.pure.id(params.oracleId),
          u64(tx, params.expiryMs),
          u64(tx, leg.strike),
          tx.pure.bool(leg.isUp),
        ],
      });

      tx.moveCall({
        target: `${contracts.predictPackageId}::predict::mint`,
        typeArguments: [contracts.quoteType],
        arguments: [
          tx.object(contracts.predictObjectId),
          tx.object(params.managerId),
          tx.object(params.oracleId),
          key,
          u64(tx, leg.quantity),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
    }
  }

  return tx;
}

export function buildKnitRangeNoteTx(
  params: KnitCreateParams & {
    lowerStrike: bigint | number | string;
    higherStrike: bigint | number | string;
    quantity: bigint | number | string;
  },
) {
  const contracts = params.contracts ?? defaultContracts();
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.object(params.paymentCoinId), [u64(tx, params.maxPayment)]);

  tx.moveCall({
    target: `${params.deployment.packageId}::knit::create_range_note`,
    typeArguments: [contracts.quoteType],
    arguments: [
      tx.object(params.deployment.registryId),
      tx.object(contracts.predictObjectId),
      tx.object(params.managerId),
      tx.object(params.oracleId),
      payment,
      u64(tx, params.lowerStrike),
      u64(tx, params.higherStrike),
      u64(tx, params.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

export function buildKnitBreakoutNoteTx(
  params: KnitCreateParams & {
    lowerStrike: bigint | number | string;
    higherStrike: bigint | number | string;
    quantity: bigint | number | string;
  },
) {
  const contracts = params.contracts ?? defaultContracts();
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.object(params.paymentCoinId), [u64(tx, params.maxPayment)]);

  tx.moveCall({
    target: `${params.deployment.packageId}::knit::create_breakout_note`,
    typeArguments: [contracts.quoteType],
    arguments: [
      tx.object(params.deployment.registryId),
      tx.object(contracts.predictObjectId),
      tx.object(params.managerId),
      tx.object(params.oracleId),
      payment,
      u64(tx, params.lowerStrike),
      u64(tx, params.higherStrike),
      u64(tx, params.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

export function buildKnitLadderNoteTx(
  params: KnitCreateParams & {
    strikes: readonly [bigint | number | string, bigint | number | string, bigint | number | string];
    quantity: bigint | number | string;
  },
) {
  const contracts = params.contracts ?? defaultContracts();
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.object(params.paymentCoinId), [u64(tx, params.maxPayment)]);

  tx.moveCall({
    target: `${params.deployment.packageId}::knit::create_ladder_note`,
    typeArguments: [contracts.quoteType],
    arguments: [
      tx.object(params.deployment.registryId),
      tx.object(contracts.predictObjectId),
      tx.object(params.managerId),
      tx.object(params.oracleId),
      payment,
      u64(tx, params.strikes[0]),
      u64(tx, params.strikes[1]),
      u64(tx, params.strikes[2]),
      u64(tx, params.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

export function buildKnitRedeemNoteTx(
  params: ManagerOracleInputs & {
    receiptId: string;
    deployment: KnitDeployment;
    contracts?: PredictContracts;
  },
) {
  const contracts = params.contracts ?? defaultContracts();
  const tx = new Transaction();

  tx.moveCall({
    target: `${params.deployment.packageId}::knit::redeem_note`,
    typeArguments: [contracts.quoteType],
    arguments: [
      tx.object(params.deployment.registryId),
      tx.object(contracts.predictObjectId),
      tx.object(params.managerId),
      tx.object(params.oracleId),
      tx.object(params.receiptId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

export function buildQuoteInspectTx(params: KeyedPredictInputs & {
  legs: readonly NoteLeg[];
  contracts?: PredictContracts;
}) {
  const contracts = params.contracts ?? defaultContracts();
  const tx = new Transaction();

  for (const leg of params.legs) {
    if (leg.kind === "range") {
      const key = tx.moveCall({
        target: `${contracts.predictPackageId}::range_key::new`,
        arguments: [
          tx.pure.id(params.oracleId),
          u64(tx, params.expiryMs),
          u64(tx, leg.lowerStrike),
          u64(tx, leg.higherStrike),
        ],
      });
      tx.moveCall({
        target: `${contracts.predictPackageId}::predict::get_range_trade_amounts`,
        arguments: [
          tx.object(contracts.predictObjectId),
          tx.object(params.oracleId),
          key,
          u64(tx, leg.quantity),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
    } else {
      const key = tx.moveCall({
        target: `${contracts.predictPackageId}::market_key::new`,
        arguments: [
          tx.pure.id(params.oracleId),
          u64(tx, params.expiryMs),
          u64(tx, leg.strike),
          tx.pure.bool(leg.isUp),
        ],
      });
      tx.moveCall({
        target: `${contracts.predictPackageId}::predict::get_trade_amounts`,
        arguments: [
          tx.object(contracts.predictObjectId),
          tx.object(params.oracleId),
          key,
          u64(tx, leg.quantity),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
    }
  }

  return tx;
}

function defaultContracts(): PredictContracts {
  return {
    predictPackageId: TESTNET_CONFIG.predictPackageId,
    predictObjectId: TESTNET_CONFIG.predictObjectId,
    quoteType: TESTNET_CONFIG.quoteType,
  };
}

function u64(tx: Transaction, value: bigint | number | string) {
  return tx.pure.u64(value.toString());
}
