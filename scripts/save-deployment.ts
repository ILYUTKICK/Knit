// Captures Knit router deployment IDs into .knit-deployment.testnet.json.
//
// Decoupled from how publish is invoked: run `sui client publish` and
// `create_registry` however you like, then feed their digests here.
//
//   npm run deploy:save -- --publish <PUBLISH_DIGEST> [--registry <REGISTRY_DIGEST>]
//
// Note: managerId is intentionally NOT stored here. Per the corrected plan,
// each note mints into a FRESH PredictManager (so redeem_note's balance-delta
// is exact), so the manager is per-note, not a global deployment constant.

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

const DEPLOYMENT_PATH = join(process.cwd(), ".knit-deployment.testnet.json");

type Deployment = {
  network: string;
  packageId?: string;
  upgradeCap?: string;
  registryId?: string;
  publishDigest?: string;
  registryDigest?: string;
  savedAt: string;
};

async function main() {
  const publishDigest = argValue("--publish");
  const registryDigest = argValue("--registry");

  if (!publishDigest && !registryDigest) {
    throw new Error("Provide at least --publish <digest> (and optionally --registry <digest>)");
  }

  const client = new SuiClient({ url: getFullnodeUrl("testnet") });
  const existing = await readExisting();
  const deployment: Deployment = { ...existing, network: "testnet", savedAt: new Date().toISOString() };

  if (publishDigest) {
    const changes = await objectChanges(client, publishDigest);

    const published = changes.find((c) => c.type === "published");
    if (!published || published.type !== "published") {
      throw new Error(`No published package found in tx ${publishDigest}`);
    }
    deployment.packageId = published.packageId;
    deployment.publishDigest = publishDigest;

    const upgradeCap = changes.find(
      (c) => c.type === "created" && c.objectType.endsWith("::package::UpgradeCap"),
    );
    if (upgradeCap && upgradeCap.type === "created") deployment.upgradeCap = upgradeCap.objectId;

    console.log(`packageId      : ${deployment.packageId}`);
    if (deployment.upgradeCap) console.log(`upgradeCap     : ${deployment.upgradeCap}`);
  }

  if (registryDigest) {
    const changes = await objectChanges(client, registryDigest);
    const registry = changes.find(
      (c) => c.type === "created" && c.objectType.includes("::knit::NoteRegistry"),
    );
    if (!registry || registry.type !== "created") {
      throw new Error(`No knit::NoteRegistry created in tx ${registryDigest}`);
    }
    deployment.registryId = registry.objectId;
    deployment.registryDigest = registryDigest;
    console.log(`registryId     : ${deployment.registryId}`);
  }

  await writeFile(DEPLOYMENT_PATH, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`Saved          : ${DEPLOYMENT_PATH}`);
}

async function objectChanges(client: SuiClient, digest: string) {
  const tx = await client.getTransactionBlock({ digest, options: { showObjectChanges: true } });
  const changes = tx.objectChanges ?? [];
  if (changes.length === 0) throw new Error(`No object changes in tx ${digest} (wrong digest?)`);
  return changes;
}

async function readExisting(): Promise<Partial<Deployment>> {
  if (!existsSync(DEPLOYMENT_PATH)) return {};
  return JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as Partial<Deployment>;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
