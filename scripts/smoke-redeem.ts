// Redeems a structured note through the Knit router.
//
//   npm run smoke:redeem -- --template range
//
// Works both as an early exit (while the oracle is Active, sold at the live
// quote) and after settlement (paid at the settled price). Calls
// knit::redeem_note, which redeems every leg, measures the manager balance
// delta, withdraws exactly that payout, and emits NoteRedeemed.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { buildKnitRedeemNoteTx } from "../packages/core/src/transactions.ts";
import { TESTNET_CONFIG, type KnitDeployment } from "../packages/core/src/config.ts";
import { formatQuoteUnits } from "../packages/core/src/templates.ts";
import { loadActiveEd25519Keypair, readSuiConfig } from "./shared.ts";

type Template = "range" | "breakout" | "ladder";
type NoteEntry = { noteId: string; managerId: string; oracleId: string; expiry: number; digest: string; redeemDigest?: string };
type KnitSmokeState = Partial<Record<Template, NoteEntry>>;

const DEPLOYMENT_PATH = join(process.cwd(), ".knit-deployment.testnet.json");
const STATE_PATH = join(process.cwd(), ".knit-knit-smoke.json");

async function main() {
  const template = parseTemplate();
  const state = await readState();
  const entry = state[template];
  if (!entry) throw new Error(`No saved ${template} note in ${STATE_PATH}. Run smoke:knit --execute first.`);
  if (entry.redeemDigest) throw new Error(`${template} note already redeemed (digest ${entry.redeemDigest}).`);

  const deployment = await readDeployment();
  const suiConfig = await readSuiConfig();
  const client = new SuiClient({ url: suiConfig.rpcUrl || getFullnodeUrl("testnet") });
  const signer = await loadActiveEd25519Keypair(suiConfig);
  const address = signer.toSuiAddress();

  console.log(`Template       : ${template}`);
  console.log(`NoteReceipt    : ${entry.noteId}`);
  console.log(`Manager        : ${entry.managerId}`);
  console.log(`Oracle         : ${entry.oracleId}`);

  const before = await dusdcBalance(client, address);

  const tx = buildKnitRedeemNoteTx({
    managerId: entry.managerId,
    oracleId: entry.oracleId,
    receiptId: entry.noteId,
    deployment,
  });
  tx.setGasBudget(120_000_000);

  console.log("");
  console.log("Redeeming note via Knit router...");
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showEvents: true, showBalanceChanges: true },
    requestType: "WaitForLocalExecution",
  });

  console.log(`Redeem digest  : ${result.digest}`);
  console.log(`Status         : ${result.effects?.status.status}`);
  if (result.effects?.status.error) console.log(`Error          : ${result.effects.status.error}`);

  for (const event of (result.events ?? []).filter((e) => e.type.includes("::knit::NoteRedeemed"))) {
    console.log(`Event          : ${event.type}`);
    console.log(JSON.stringify(event.parsedJson, null, 2));
  }

  if (result.effects?.status.status === "success") {
    const after = await dusdcBalance(client, address);
    console.log(`dUSDC payout   : ${formatQuoteUnits(after - before)} dUSDC (wallet ${formatQuoteUnits(before)} -> ${formatQuoteUnits(after)})`);
    entry.redeemDigest = result.digest;
    state[template] = entry;
    await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
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

async function dusdcBalance(client: SuiClient, owner: string): Promise<bigint> {
  const coins = await client.getCoins({ owner, coinType: TESTNET_CONFIG.quoteType });
  return coins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
}

async function readState(): Promise<KnitSmokeState> {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(await readFile(STATE_PATH, "utf8")) as KnitSmokeState;
}

async function readDeployment(): Promise<KnitDeployment> {
  if (!existsSync(DEPLOYMENT_PATH)) throw new Error(`Missing ${DEPLOYMENT_PATH}`);
  const raw = JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as Partial<KnitDeployment>;
  if (!raw.packageId || !raw.registryId) throw new Error("Deployment file missing packageId/registryId");
  return { packageId: raw.packageId, registryId: raw.registryId };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
