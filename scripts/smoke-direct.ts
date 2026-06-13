import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { buildDirectMintNoteTx, buildQuoteInspectTx } from "../packages/core/src/transactions.ts";
import { TESTNET_CONFIG } from "../packages/core/src/config.ts";
import { asQuoteUnits, formatQuoteUnits, type BinaryLeg } from "../packages/core/src/templates.ts";

type SuiConfig = {
  activeAddress: string;
  activeEnv: string;
  rpcUrl: string;
  keystorePath: string;
};

type OracleSummary = {
  oracle_id: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: string;
};

type OracleState = {
  oracle: OracleSummary;
  latest_price?: {
    spot: number;
    forward: number;
  };
  ask_bounds?: {
    min_ask_price?: number;
    max_ask_price?: number;
  } | null;
};

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

  const oracleState = await pickActiveBtcOracle();
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

async function readSuiConfig(): Promise<SuiConfig> {
  const configPath = join(homedir(), ".sui/sui_config/client.yaml");
  const raw = await readFile(configPath, "utf8");
  const activeEnv = mustMatch(raw, /active_env:\s*([^\n]+)/, "active_env").replaceAll('"', "").trim();
  const activeAddress = mustMatch(raw, /active_address:\s*"([^"]+)"/, "active_address").trim();
  const keystorePath = mustMatch(raw, /File:\s*([^\n]+)/, "keystore File").trim();
  const envBlock = raw.split(`alias: ${activeEnv}`)[1] ?? raw;
  const rpcUrl = mustMatch(envBlock, /rpc:\s*"([^"]+)"/, "active env rpc").trim();
  return { activeAddress, activeEnv, rpcUrl, keystorePath };
}

async function loadActiveEd25519Keypair(config: SuiConfig): Promise<Ed25519Keypair> {
  const raw = await readFile(config.keystorePath, "utf8");
  const keys = JSON.parse(raw) as string[];

  for (const key of keys) {
    const keypair = ed25519FromStoredKey(key);
    if (keypair?.toSuiAddress() === config.activeAddress) return keypair;
  }

  throw new Error(`No ED25519 key in ${config.keystorePath} matched ${config.activeAddress}`);
}

function ed25519FromStoredKey(key: string): Ed25519Keypair | null {
  try {
    if (key.startsWith("suiprivkey")) {
      const decoded = decodeSuiPrivateKey(key);
      if (decoded.schema !== "ED25519") return null;
      return Ed25519Keypair.fromSecretKey(decoded.secretKey);
    }

    const bytes = Buffer.from(key, "base64");
    if (bytes[0] !== 0) return null;
    return Ed25519Keypair.fromSecretKey(bytes.subarray(1, 33));
  } catch {
    return null;
  }
}

async function pickActiveBtcOracle(): Promise<OracleState> {
  const minExpiry = Date.now() + MIN_EXPIRY_BUFFER_MS;
  const oracles = await fetchJson<OracleSummary[]>(
    `${TESTNET_CONFIG.predictServerUrl}/predicts/${TESTNET_CONFIG.predictObjectId}/oracles`,
  );
  const active = oracles
    .filter((oracle) => oracle.underlying_asset === "BTC" && oracle.status === "active" && oracle.expiry > minExpiry)
    .sort((a, b) => a.expiry - b.expiry);

  if (active.length === 0) {
    throw new Error("No active future BTC oracle found on Predict testnet with enough expiry buffer");
  }

  for (const oracle of active) {
    const state = await fetchJson<OracleState>(
      `${TESTNET_CONFIG.predictServerUrl}/oracles/${oracle.oracle_id}/state`,
    );
    if (state.latest_price?.spot) return state;
  }

  throw new Error("Active BTC oracles found, but none had latest price data");
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function printDevInspect(label: string, result: Awaited<ReturnType<SuiClient["devInspectTransactionBlock"]>>) {
  console.log("");
  console.log(`${label}: ${result.effects.status.status}`);
  if (result.effects.status.error) console.log(`  error: ${result.effects.status.error}`);

  for (const [index, command] of (result.results ?? []).entries()) {
    const values = command.returnValues ?? [];
    if (values.length === 0) continue;
    const decoded = values.map(([bytes, type]) => formatReturnValue(bytes, type)).join(", ");
    console.log(`  command ${index}: ${decoded}`);
  }
}

function printPredictEvents(events: Array<{ type: string; parsedJson?: unknown }>) {
  const predictEvents = events.filter((event) => event.type.includes("deepbook_predict::predict::"));
  for (const event of predictEvents) {
    console.log(`Event          : ${event.type}`);
    console.log(JSON.stringify(event.parsedJson, null, 2));
  }
}

function decodeU64(bytes: number[]): bigint {
  let value = 0n;
  for (let index = 0; index < Math.min(bytes.length, 8); index += 1) {
    value += BigInt(bytes[index]) << (BigInt(index) * 8n);
  }
  return value;
}

function formatReturnValue(bytes: number[], type: string): string {
  if (type === "u64") return `${decodeU64(bytes)} u64`;
  return `${bytes.length} bytes ${type}`;
}

function roundToGrid(value: bigint, min: bigint, tick: bigint): bigint {
  if (value <= min) return min;
  const ticks = (value - min + tick / 2n) / tick;
  return min + ticks * tick;
}

function formatOraclePrice(value: bigint): string {
  const scale = 1_000_000_000n;
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function mustMatch(raw: string, pattern: RegExp, label: string): string {
  const match = raw.match(pattern);
  if (!match) throw new Error(`Could not parse ${label} from Sui client config`);
  return match[1];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
