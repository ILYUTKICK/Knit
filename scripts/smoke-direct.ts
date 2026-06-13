import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { buildDirectMintNoteTx, buildQuoteInspectTx } from "../packages/core/src/transactions.ts";
import { TESTNET_CONFIG } from "../packages/core/src/config.ts";
import { asQuoteUnits, formatQuoteUnits, type BinaryLeg } from "../packages/core/src/templates.ts";
import {
  formatOraclePrice,
  loadActiveEd25519Keypair,
  type OracleState,
  pickActiveBtcOracle,
  printDevInspect,
  readSuiConfig,
  roundToGrid,
} from "./shared.ts";

type SmokeState = {
  managerId?: string;
};

const STATE_PATH = join(process.cwd(), ".knit-smoke.json");
const EXECUTE = process.argv.includes("--execute");
const RANGE_CHECK = process.argv.includes("--range-check");
const QUANTITY = asQuoteUnits(Number(process.env.KNIT_SMOKE_NOTIONAL_USD ?? "1"), TESTNET_CONFIG.quoteDecimals);
const MAX_PAYMENT = asQuoteUnits(Number(process.env.KNIT_SMOKE_MAX_PAYMENT_USD ?? "1"), TESTNET_CONFIG.quoteDecimals);
const MIN_EXPIRY_BUFFER_MS = Number(process.env.KNIT_SMOKE_MIN_EXPIRY_BUFFER_MS ?? `${15 * 60 * 1000}`);

async function main() {
  const suiConfig = await readSuiConfig();
  const client = new SuiClient({ url: suiConfig.rpcUrl || getFullnodeUrl("testnet") });
  const signer = await loadActiveEd25519Keypair(suiConfig);
  const address = signer.toSuiAddress();

  if (address !== suiConfig.activeAddress) {
    throw new Error(`Active signer mismatch: config=${suiConfig.activeAddress}, key=${address}`);
  }

  console.log(`Network        : ${suiConfig.activeEnv}`);
  console.log(`Address        : ${address}`);
  console.log(`Mode           : ${EXECUTE ? "EXECUTE real mint" : "quote/devInspect only"}`);

  const oracleState = await pickActiveBtcOracle(MIN_EXPIRY_BUFFER_MS);
  const strike = roundToGrid(
    BigInt(oracleState.latest_price?.spot ?? oracleState.oracle.min_strike),
    BigInt(oracleState.oracle.min_strike),
    BigInt(oracleState.oracle.tick_size),
  );
  const leg: BinaryLeg = {
    kind: "binary",
    isUp: true,
    strike,
    quantity: QUANTITY,
  };

  console.log(`Oracle         : ${oracleState.oracle.oracle_id}`);
  console.log(`Expiry         : ${new Date(oracleState.oracle.expiry).toISOString()} (${oracleState.oracle.expiry})`);
  console.log(`Spot           : ${formatOraclePrice(BigInt(oracleState.latest_price?.spot ?? 0))}`);
  console.log(`Strike         : ${formatOraclePrice(strike)}`);
  console.log(`Quantity       : ${formatQuoteUnits(QUANTITY, TESTNET_CONFIG.quoteDecimals)} dUSDC payout units`);

  const quoteTx = buildQuoteInspectTx({
    oracleId: oracleState.oracle.oracle_id,
    expiryMs: oracleState.oracle.expiry,
    legs: [leg],
  });
  const quote = await client.devInspectTransactionBlock({
    sender: address,
    transactionBlock: quoteTx,
  });
  printDevInspect("Binary quote", quote);

  if (RANGE_CHECK) {
    await checkRangeQuote(client, address, oracleState, strike);
  }

  const suiBalance = await client.getBalance({ owner: address });
  if (BigInt(suiBalance.totalBalance) === 0n) {
    console.log("");
    console.log("Missing SUI gas. Open:");
    console.log(`https://faucet.sui.io/?address=${address}`);
    if (EXECUTE) process.exit(1);
  }

  const dusdcCoins = await client.getCoins({
    owner: address,
    coinType: TESTNET_CONFIG.quoteType,
  });
  const paymentCoin = dusdcCoins.data.find((coin) => BigInt(coin.balance) >= MAX_PAYMENT);
  if (!paymentCoin) {
    console.log("");
    console.log(`Missing dUSDC coin with at least ${formatQuoteUnits(MAX_PAYMENT)} dUSDC.`);
    console.log("Request dUSDC here: https://tally.so/r/Xx102L");
    console.log(`Use address: ${address}`);
    if (EXECUTE) process.exit(1);
  }

  if (!EXECUTE) {
    console.log("");
    console.log("Dry smoke finished. Fund SUI + dUSDC, then run:");
    console.log("npm run smoke:direct -- --execute");
    return;
  }

  const managerId = await getOrCreateManager(client, signer);
  if (!paymentCoin) throw new Error("dUSDC payment coin disappeared before execute");

  const mintTx = buildDirectMintNoteTx({
    managerId,
    oracleId: oracleState.oracle.oracle_id,
    expiryMs: oracleState.oracle.expiry,
    paymentCoinId: paymentCoin.coinObjectId,
    maxPayment: MAX_PAYMENT,
    legs: [leg],
  });
  mintTx.setGasBudget(80_000_000);

  console.log("");
  console.log("Executing direct Predict mint...");
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: mintTx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
      showBalanceChanges: true,
    },
    requestType: "WaitForLocalExecution",
  });

  console.log(`Mint digest    : ${result.digest}`);
  console.log(`Status         : ${result.effects?.status.status}`);
  if (result.effects?.status.error) console.log(`Error          : ${result.effects.status.error}`);
  printPredictEvents(result.events ?? []);
}

async function checkRangeQuote(
  client: SuiClient,
  sender: string,
  oracleState: OracleState,
  atmStrike: bigint,
) {
  const tick = BigInt(oracleState.oracle.tick_size);
  const lowerStrike = atmStrike > tick * 5n ? atmStrike - tick * 5n : atmStrike;
  const higherStrike = atmStrike + tick * 5n;
  const rangeTx = buildQuoteInspectTx({
    oracleId: oracleState.oracle.oracle_id,
    expiryMs: oracleState.oracle.expiry,
    legs: [{ kind: "range", lowerStrike, higherStrike, quantity: QUANTITY }],
  });
  const quote = await client.devInspectTransactionBlock({
    sender,
    transactionBlock: rangeTx,
  });
  printDevInspect("Range quote", quote);
}

async function getOrCreateManager(client: SuiClient, signer: Ed25519Keypair): Promise<string> {
  const state = await readSmokeState();
  if (state.managerId) {
    console.log(`Manager        : ${state.managerId} (cached)`);
    return state.managerId;
  }

  console.log("");
  console.log("Creating PredictManager...");
  const tx = new Transaction();
  tx.moveCall({
    target: `${TESTNET_CONFIG.predictPackageId}::predict::create_manager`,
  });
  tx.setGasBudget(50_000_000);

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType: "WaitForLocalExecution",
  });

  const manager = result.objectChanges?.find(
    (change) => change.type === "created" && change.objectType.endsWith("::predict_manager::PredictManager"),
  );
  if (!manager || manager.type !== "created") {
    throw new Error(`Could not find created PredictManager in tx ${result.digest}`);
  }

  await writeSmokeState({ managerId: manager.objectId });
  console.log(`Manager digest : ${result.digest}`);
  console.log(`Manager        : ${manager.objectId}`);
  return manager.objectId;
}

async function readSmokeState(): Promise<SmokeState> {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(await readFile(STATE_PATH, "utf8")) as SmokeState;
}

async function writeSmokeState(state: SmokeState) {
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function printPredictEvents(events: Array<{ type: string; parsedJson?: unknown }>) {
  const predictEvents = events.filter((event) => event.type.includes("deepbook_predict::predict::"));
  for (const event of predictEvents) {
    console.log(`Event          : ${event.type}`);
    console.log(JSON.stringify(event.parsedJson, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
