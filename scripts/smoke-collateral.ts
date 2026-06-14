// Live composability proof: pledge a real Knit NoteReceipt into the independent
// knit_demo collateral vault, then release it back.
//
//   npm run smoke:collateral -- --template ladder
//
// Demonstrates that an external package can take a structured note by value, read
// its public getters on-chain, custody it, and hand it back — the "structured note
// as composable collateral" story, live on testnet.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { loadActiveEd25519Keypair, readSuiConfig } from "./shared.ts";

type Template = "range" | "breakout" | "ladder";
type NoteEntry = { noteId: string; redeemDigest?: string };

const DEPLOYMENT_PATH = join(process.cwd(), ".knit-deployment.testnet.json");
const STATE_PATH = join(process.cwd(), ".knit-knit-smoke.json");

async function main() {
  const template = parseTemplate();
  const noteId = await readNoteId(template);
  const demoPackageId = await readDemoPackageId();

  const suiConfig = await readSuiConfig();
  const client = new SuiClient({ url: suiConfig.rpcUrl || getFullnodeUrl("testnet") });
  const signer = await loadActiveEd25519Keypair(suiConfig);
  const address = signer.toSuiAddress();

  console.log(`Demo package   : ${demoPackageId}`);
  console.log(`Note (${template}) : ${noteId}`);

  // 1. Create the collateral vault (shared).
  console.log("");
  console.log("Creating collateral vault...");
  const vaultTx = new Transaction();
  vaultTx.moveCall({ target: `${demoPackageId}::collateral_vault::new_vault` });
  const vaultRes = await exec(client, signer, vaultTx);
  const vaultId = findCreated(vaultRes, "::collateral_vault::CollateralVault");
  console.log(`Vault          : ${vaultId} (digest ${vaultRes.digest})`);

  // 2. Pledge the note: external module takes it by value and reads its getters.
  console.log("");
  console.log("Pledging note as collateral...");
  const pledgeTx = new Transaction();
  const receipt = pledgeTx.moveCall({
    target: `${demoPackageId}::collateral_vault::pledge`,
    arguments: [pledgeTx.object(vaultId), pledgeTx.object(noteId)],
  });
  pledgeTx.transferObjects([receipt], pledgeTx.pure.address(address));
  const pledgeRes = await exec(client, signer, pledgeTx);
  console.log(`Pledge digest  : ${pledgeRes.digest} (${pledgeRes.effects?.status.status})`);
  printEvent(pledgeRes, "NotePledged");
  const collateralReceiptId = findCreated(pledgeRes, "::collateral_vault::CollateralReceipt");
  console.log(`Claim receipt  : ${collateralReceiptId}`);

  // 3. Release the note back to the owner.
  console.log("");
  console.log("Releasing note back...");
  const releaseTx = new Transaction();
  const note = releaseTx.moveCall({
    target: `${demoPackageId}::collateral_vault::release`,
    arguments: [releaseTx.object(vaultId), releaseTx.object(collateralReceiptId)],
  });
  releaseTx.transferObjects([note], releaseTx.pure.address(address));
  const releaseRes = await exec(client, signer, releaseTx);
  console.log(`Release digest : ${releaseRes.digest} (${releaseRes.effects?.status.status})`);
  printEvent(releaseRes, "NoteReleased");

  console.log("");
  console.log("Composability roundtrip complete: external package held a real Knit note and returned it.");
}

async function exec(client: SuiClient, signer: Ed25519Keypair, transaction: Transaction) {
  transaction.setGasBudget(60_000_000);
  return client.signAndExecuteTransaction({
    signer,
    transaction,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
    requestType: "WaitForLocalExecution",
  });
}

function findCreated(res: Awaited<ReturnType<SuiClient["signAndExecuteTransaction"]>>, typeSuffix: string): string {
  const change = res.objectChanges?.find((c) => c.type === "created" && c.objectType.includes(typeSuffix));
  if (!change || change.type !== "created") throw new Error(`No created ${typeSuffix} in tx ${res.digest}`);
  return change.objectId;
}

function printEvent(res: Awaited<ReturnType<SuiClient["signAndExecuteTransaction"]>>, name: string) {
  for (const event of (res.events ?? []).filter((e) => e.type.includes(`::${name}`))) {
    console.log(`Event          : ${event.type}`);
    console.log(JSON.stringify(event.parsedJson, null, 2));
  }
}

function parseTemplate(): Template {
  const index = process.argv.indexOf("--template");
  const value = index === -1 ? "ladder" : process.argv[index + 1];
  if (value !== "range" && value !== "breakout" && value !== "ladder") {
    throw new Error("Pass --template range|breakout|ladder");
  }
  return value;
}

async function readNoteId(template: Template): Promise<string> {
  if (!existsSync(STATE_PATH)) throw new Error(`Missing ${STATE_PATH}. Run smoke:knit --execute first.`);
  const state = JSON.parse(await readFile(STATE_PATH, "utf8")) as Partial<Record<Template, NoteEntry>>;
  const entry = state[template];
  if (!entry) throw new Error(`No saved ${template} note.`);
  if (entry.redeemDigest) throw new Error(`${template} note was already redeemed; pick an open note.`);
  return entry.noteId;
}

async function readDemoPackageId(): Promise<string> {
  if (!existsSync(DEPLOYMENT_PATH)) throw new Error(`Missing ${DEPLOYMENT_PATH}`);
  const raw = JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as { demoPackageId?: string };
  if (!raw.demoPackageId) throw new Error("Deployment file missing demoPackageId (publish knit_demo first)");
  return raw.demoPackageId;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
