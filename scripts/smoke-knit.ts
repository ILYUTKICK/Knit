// Mints a structured note through the Knit router (range / breakout / ladder).
//
//   npm run smoke:knit -- --template range            # dry quote, no funds
//   npm run smoke:knit -- --template breakout --execute
//
// Each --execute run creates a FRESH PredictManager (clean isolation + explorer
// story), mints the note in one PTB, captures the NoteReceipt id + NoteCreated
// event, and records it in .knit-knit-smoke.json for the redeem step (Phase 5).

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  buildCreateManagerTx,
  buildKnitBreakoutNoteTx,
  buildKnitLadderNoteTx,
  buildKnitRangeNoteTx,
  buildQuoteInspectTx,
} from "../packages/core/src/transactions.ts";
import { TESTNET_CONFIG, type KnitDeployment } from "../packages/core/src/config.ts";
import {
  asQuoteUnits,
  formatQuoteUnits,
  makeBreakoutNote,
  makeLadderNote,
  makeRangeNote,
  type NoteDefinition,
} from "../packages/core/src/templates.ts";
import {
  formatOraclePrice,
  loadActiveEd25519Keypair,
  type OracleState,
  pickActiveBtcOracle,
  printDevInspect,
  readSuiConfig,
  roundToGrid,
} from "./shared.ts";

type Template = "range" | "breakout" | "ladder";
type KnitSmokeState = Partial<
  Record<Template, { noteId: string; managerId: string; oracleId: string; expiry: number; digest: string }>
>;

const DEPLOYMENT_PATH = join(process.cwd(), ".knit-deployment.testnet.json");
const STATE_PATH = join(process.cwd(), ".knit-knit-smoke.json");
const EXECUTE = process.argv.includes("--execute");
const TEMPLATE = parseTemplate();
const QUANTITY = asQuoteUnits(Number(process.env.KNIT_SMOKE_NOTIONAL_USD ?? "1"), TESTNET_CONFIG.quoteDecimals);
const MAX_PAYMENT = asQuoteUnits(Number(process.env.KNIT_SMOKE_MAX_PAYMENT_USD ?? "3"), TESTNET_CONFIG.quoteDecimals);
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
  console.log(`Template       : ${TEMPLATE}`);
  console.log(`Mode           : ${EXECUTE ? "EXECUTE real note" : "quote/devInspect only"}`);

  const oracleState = await pickActiveBtcOracle(MIN_EXPIRY_BUFFER_MS);
  const { oracle } = oracleState;
  const strikes = buildStrikes(oracleState);
  const note = buildNote(TEMPLATE, strikes);

  console.log(`Oracle         : ${oracle.oracle_id}`);
  console.log(`Expiry         : ${new Date(oracle.expiry).toISOString()} (${oracle.expiry})`);
  console.log(`Spot           : ${formatOraclePrice(BigInt(oracleState.latest_price?.spot ?? 0))}`);
  console.log(`Strikes        : ${strikes.map((s) => formatOraclePrice(s)).join(", ")}`);
  console.log(`Quantity       : ${formatQuoteUnits(QUANTITY)} per leg`);
  console.log(`Max payout     : ${formatQuoteUnits(note.maxPayout)} dUSDC`);

  // On-chain cost preview: sum of per-leg mint_cost from get_*_trade_amounts.
  const quoteTx = buildQuoteInspectTx({
    oracleId: oracle.oracle_id,
    expiryMs: oracle.expiry,
    legs: note.legs,
  });
  const quote = await client.devInspectTransactionBlock({ sender: address, transactionBlock: quoteTx });
  printDevInspect(`${TEMPLATE} quote (per-leg: mint_cost, redeem_now)`, quote);

  if (!EXECUTE) {
    console.log("");
    console.log("Dry run finished. Fund dUSDC, then run:");
    console.log(`npm run smoke:knit -- --template ${TEMPLATE} --execute`);
    return;
  }

  const deployment = await readDeployment();
  const paymentCoin = await findPaymentCoin(client, address);

  const managerId = await createFreshManager(client, signer);
  const noteTx = buildNoteTx(TEMPLATE, {
    managerId,
    oracleId: oracle.oracle_id,
    paymentCoinId: paymentCoin,
    maxPayment: MAX_PAYMENT,
    deployment,
    recipient: address,
    strikes,
  });
  noteTx.setGasBudget(120_000_000);

  console.log("");
  console.log(`Creating ${TEMPLATE} note via Knit router...`);
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: noteTx,
    options: { showEffects: true, showEvents: true, showObjectChanges: true, showBalanceChanges: true },
    requestType: "WaitForLocalExecution",
  });

  console.log(`Note digest    : ${result.digest}`);
  console.log(`Status         : ${result.effects?.status.status}`);
  if (result.effects?.status.error) console.log(`Error          : ${result.effects.status.error}`);

  const receipt = result.objectChanges?.find(
    (c) => c.type === "created" && c.objectType.endsWith("::knit::NoteReceipt"),
  );
  const noteId = receipt && receipt.type === "created" ? receipt.objectId : undefined;
  if (noteId) console.log(`NoteReceipt    : ${noteId}`);
  printKnitEvents(result.events ?? []);

  if (noteId && result.effects?.status.status === "success") {
    await saveState(TEMPLATE, {
      noteId,
      managerId,
      oracleId: oracle.oracle_id,
      expiry: oracle.expiry,
      digest: result.digest,
    });
    console.log(`Saved          : ${STATE_PATH}`);
  }
}

function parseTemplate(): Template {
  const index = process.argv.indexOf("--template");
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value !== "range" && value !== "breakout" && value !== "ladder") {
    throw new Error("Pass --template range|breakout|ladder");
  }
  return value;
}

function buildStrikes(oracleState: OracleState): bigint[] {
  const tick = BigInt(oracleState.oracle.tick_size);
  const min = BigInt(oracleState.oracle.min_strike);
  const atm = roundToGrid(BigInt(oracleState.latest_price?.spot ?? oracleState.oracle.min_strike), min, tick);
  const lower = atm > min + tick * 5n ? atm - tick * 5n : min;
  if (TEMPLATE === "ladder") return [atm, atm + tick * 5n, atm + tick * 10n];
  return [lower, atm + tick * 5n];
}

function buildNote(template: Template, strikes: bigint[]): NoteDefinition {
  if (template === "range") return makeRangeNote({ lowerStrike: strikes[0], higherStrike: strikes[1], quantity: QUANTITY });
  if (template === "breakout") return makeBreakoutNote({ lowerStrike: strikes[0], higherStrike: strikes[1], quantity: QUANTITY });
  return makeLadderNote({ strikes: [strikes[0], strikes[1], strikes[2]], quantity: QUANTITY });
}

function buildNoteTx(
  template: Template,
  params: {
    managerId: string;
    oracleId: string;
    paymentCoinId: string;
    maxPayment: bigint;
    deployment: KnitDeployment;
    recipient: string;
    strikes: bigint[];
  },
) {
  const base = {
    managerId: params.managerId,
    oracleId: params.oracleId,
    paymentCoinId: params.paymentCoinId,
    maxPayment: params.maxPayment,
    deployment: params.deployment,
    recipient: params.recipient,
  };
  if (template === "range") {
    return buildKnitRangeNoteTx({ ...base, lowerStrike: params.strikes[0], higherStrike: params.strikes[1], quantity: QUANTITY });
  }
  if (template === "breakout") {
    return buildKnitBreakoutNoteTx({ ...base, lowerStrike: params.strikes[0], higherStrike: params.strikes[1], quantity: QUANTITY });
  }
  return buildKnitLadderNoteTx({ ...base, strikes: [params.strikes[0], params.strikes[1], params.strikes[2]], quantity: QUANTITY });
}

async function createFreshManager(client: SuiClient, signer: Ed25519Keypair): Promise<string> {
  console.log("");
  console.log("Creating fresh PredictManager...");
  const tx = buildCreateManagerTx();
  tx.setGasBudget(50_000_000);
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
    requestType: "WaitForLocalExecution",
  });
  const manager = result.objectChanges?.find(
    (c) => c.type === "created" && c.objectType.endsWith("::predict_manager::PredictManager"),
  );
  if (!manager || manager.type !== "created") {
    throw new Error(`Could not find created PredictManager in tx ${result.digest}`);
  }
  console.log(`Manager        : ${manager.objectId} (digest ${result.digest})`);
  return manager.objectId;
}

async function readDeployment(): Promise<KnitDeployment> {
  if (!existsSync(DEPLOYMENT_PATH)) {
    throw new Error(`Missing ${DEPLOYMENT_PATH}. Publish first, then run: npm run deploy:save -- --publish <d> --registry <d>`);
  }
  const raw = JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as Partial<KnitDeployment>;
  if (!raw.packageId || !raw.registryId) throw new Error(`Deployment file missing packageId/registryId`);
  return { packageId: raw.packageId, registryId: raw.registryId };
}

async function findPaymentCoin(client: SuiClient, address: string): Promise<string> {
  const coins = await client.getCoins({ owner: address, coinType: TESTNET_CONFIG.quoteType });
  const coin = coins.data.find((c) => BigInt(c.balance) >= MAX_PAYMENT);
  if (!coin) {
    console.log("");
    console.log(`Missing dUSDC coin with at least ${formatQuoteUnits(MAX_PAYMENT)} dUSDC.`);
    console.log("Request dUSDC here: https://tally.so/r/Xx102L");
    console.log(`Use address: ${address}`);
    process.exit(1);
  }
  return coin.coinObjectId;
}

function printKnitEvents(events: Array<{ type: string; parsedJson?: unknown }>) {
  for (const event of events.filter((e) => e.type.includes("::knit::"))) {
    console.log(`Event          : ${event.type}`);
    console.log(JSON.stringify(event.parsedJson, null, 2));
  }
}

async function readState(): Promise<KnitSmokeState> {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(await readFile(STATE_PATH, "utf8")) as KnitSmokeState;
}

async function saveState(template: Template, entry: NonNullable<KnitSmokeState[Template]>) {
  const state = await readState();
  state[template] = entry;
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
