// Live chain layer for the Knit web app — talks to DeepBook Predict testnet,
// the public Predict server, and a browser wallet (wallet-standard). Mirrors the
// proven logic in scripts/ + packages/core so the UI drives real on-chain mints.

import { SuiClient, getFullnodeUrl } from "https://esm.sh/@mysten/sui@1.30.0/client";
import { Transaction } from "https://esm.sh/@mysten/sui@1.30.0/transactions";
import { SUI_CLOCK_OBJECT_ID } from "https://esm.sh/@mysten/sui@1.30.0/utils";
import { getWallets } from "https://esm.sh/@mysten/wallet-standard@0.13.0";

export const CONFIG = {
  predictServerUrl: "https://predict-server.testnet.mystenlabs.com",
  predictPackageId: "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138",
  predictObjectId: "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a",
  quoteType: "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC",
  quoteDecimals: 6,
  priceScale: 1_000_000_000n, // oracle prices are scaled by 1e9
  knitPackageId: "0xf5b66db021ad7ee7cea7d3f577117bae358e5aded21161076636bdc75f551ad0",
  registryId: "0x83eedf91118eebc29b62cdd19481f65ab6d9f5b4229bf2206ea3fdfa03848091",
  chain: "sui:testnet",
};

export const client = new SuiClient({ url: getFullnodeUrl("testnet") });

// ---------- oracle ----------

export async function loadActiveOracle() {
  const minExpiry = Date.now() + 15 * 60 * 1000;
  const oracles = await fetchJson(`${CONFIG.predictServerUrl}/predicts/${CONFIG.predictObjectId}/oracles`);
  const active = oracles
    .filter((o) => o.underlying_asset === "BTC" && o.status === "active" && o.expiry > minExpiry)
    .sort((a, b) => a.expiry - b.expiry);
  for (const o of active) {
    const state = await fetchJson(`${CONFIG.predictServerUrl}/oracles/${o.oracle_id}/state`);
    if (state.latest_price?.spot) {
      return {
        oracleId: o.oracle_id,
        expiry: o.expiry,
        minStrike: BigInt(o.min_strike),
        tick: BigInt(o.tick_size),
        spotScaled: BigInt(Math.round(state.latest_price.spot)),
        spotUsd: Number(state.latest_price.spot) / 1e9,
      };
    }
  }
  throw new Error("No active BTC oracle with price data");
}

// dollar strike -> oracle scaled units, snapped to the tick grid
export function usdToScaled(usd, oracle) {
  const raw = BigInt(Math.round(usd)) * CONFIG.priceScale;
  if (raw <= oracle.minStrike) return oracle.minStrike;
  const ticks = (raw - oracle.minStrike + oracle.tick / 2n) / oracle.tick;
  return oracle.minStrike + ticks * oracle.tick;
}

export const scaledToUsd = (scaled) => Number(scaled / CONFIG.priceScale);
export const toQuoteUnits = (usd) => BigInt(Math.round(usd * 10 ** CONFIG.quoteDecimals));
export const fromQuoteUnits = (units) => Number(units) / 10 ** CONFIG.quoteDecimals;

// ---------- legs ----------

// template + dollar strikes -> on-chain legs (scaled). qty in quote base units.
export function buildLegs(template, strikesUsd, qtyUnits, oracle) {
  const s = strikesUsd.map((u) => usdToScaled(u, oracle));
  if (template === "range") return [{ kind: "range", lower: s[0], higher: s[1], qty: qtyUnits }];
  if (template === "breakout") {
    return [
      { kind: "binary", isUp: false, strike: s[0], qty: qtyUnits },
      { kind: "binary", isUp: true, strike: s[1], qty: qtyUnits },
    ];
  }
  return s.map((strike) => ({ kind: "binary", isUp: true, strike, qty: qtyUnits }));
}

// ---------- quote (devInspect) ----------

export async function quote(oracle, legs, sender) {
  const tx = new Transaction();
  for (const leg of legs) {
    if (leg.kind === "range") {
      const key = tx.moveCall({
        target: `${CONFIG.predictPackageId}::range_key::new`,
        arguments: [tx.pure.id(oracle.oracleId), u64(tx, oracle.expiry), u64(tx, leg.lower), u64(tx, leg.higher)],
      });
      tx.moveCall({
        target: `${CONFIG.predictPackageId}::predict::get_range_trade_amounts`,
        arguments: [tx.object(CONFIG.predictObjectId), tx.object(oracle.oracleId), key, u64(tx, leg.qty), tx.object(SUI_CLOCK_OBJECT_ID)],
      });
    } else {
      const key = tx.moveCall({
        target: `${CONFIG.predictPackageId}::market_key::new`,
        arguments: [tx.pure.id(oracle.oracleId), u64(tx, oracle.expiry), u64(tx, leg.strike), tx.pure.bool(leg.isUp)],
      });
      tx.moveCall({
        target: `${CONFIG.predictPackageId}::predict::get_trade_amounts`,
        arguments: [tx.object(CONFIG.predictObjectId), tx.object(oracle.oracleId), key, u64(tx, leg.qty), tx.object(SUI_CLOCK_OBJECT_ID)],
      });
    }
  }
  const res = await client.devInspectTransactionBlock({ sender: sender ?? CONFIG.registryId, transactionBlock: tx });
  if (res.effects.status.status !== "success") throw new Error(res.effects.status.error ?? "quote failed");

  // each leg yields a key command (no return) + an amounts command (2 u64s)
  let cost = 0n;
  for (const cmd of res.results ?? []) {
    const vals = cmd.returnValues ?? [];
    if (vals.length === 2) cost += decodeU64(vals[0][0]); // mint_cost
  }
  return { costUnits: cost };
}

// ---------- wallet ----------

let wallet = null;
let account = null;

export function findWallet() {
  const wallets = getWallets().get();
  return wallets.find((w) => w.features["sui:signAndExecuteTransaction"] && w.features["standard:connect"]) ?? null;
}

export async function connect() {
  wallet = findWallet();
  if (!wallet) throw new Error("No Sui wallet found. Install Slush / a Sui wallet.");
  const res = await wallet.features["standard:connect"].connect();
  account = (res.accounts ?? wallet.accounts).find((a) => a.chains.some((c) => c.startsWith("sui:"))) ?? wallet.accounts[0];
  if (!account) throw new Error("Wallet returned no account");
  return account.address;
}

export const address = () => account?.address ?? null;

async function signAndExecute(tx) {
  const res = await wallet.features["sui:signAndExecuteTransaction"].signAndExecuteTransaction({
    transaction: tx,
    account,
    chain: CONFIG.chain,
  });
  return res;
}

// ---------- manager (one reused per user, cached) ----------

const MANAGER_KEY = "knit.managerId";

export async function ensureManager(onStatus) {
  const cached = localStorage.getItem(MANAGER_KEY);
  if (cached) return cached;
  onStatus?.("Creating your PredictManager (one-time)...");
  const tx = new Transaction();
  tx.moveCall({ target: `${CONFIG.predictPackageId}::predict::create_manager` });
  const res = await signAndExecute(tx);
  const created = await findCreatedObject(res.digest, "::predict_manager::PredictManager");
  localStorage.setItem(MANAGER_KEY, created);
  return created;
}

// ---------- mint a note ----------

export async function createNote({ template, strikesUsd, qtyUnits, maxPaymentUnits, oracle, onStatus }) {
  const owner = address();
  if (!owner) throw new Error("Connect a wallet first");
  const managerId = await ensureManager(onStatus);
  const paymentCoin = await findCoin(owner, maxPaymentUnits);

  onStatus?.("Building one atomic PTB (deposit + mint all legs)...");
  const s = strikesUsd.map((u) => usdToScaled(u, oracle));
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.object(paymentCoin), [u64(tx, maxPaymentUnits)]);

  const args = (extra) => [
    tx.object(CONFIG.registryId),
    tx.object(CONFIG.predictObjectId),
    tx.object(managerId),
    tx.object(oracle.oracleId),
    payment,
    ...extra,
    u64(tx, qtyUnits),
    tx.object(SUI_CLOCK_OBJECT_ID),
  ];

  let note;
  if (template === "range") {
    note = tx.moveCall({ target: `${CONFIG.knitPackageId}::knit::create_range_note`, typeArguments: [CONFIG.quoteType], arguments: args([u64(tx, s[0]), u64(tx, s[1])]) });
  } else if (template === "breakout") {
    note = tx.moveCall({ target: `${CONFIG.knitPackageId}::knit::create_breakout_note`, typeArguments: [CONFIG.quoteType], arguments: args([u64(tx, s[0]), u64(tx, s[1])]) });
  } else {
    note = tx.moveCall({ target: `${CONFIG.knitPackageId}::knit::create_ladder_note`, typeArguments: [CONFIG.quoteType], arguments: args([u64(tx, s[0]), u64(tx, s[1]), u64(tx, s[2])]) });
  }
  tx.transferObjects([note], tx.pure.address(owner));

  onStatus?.("Awaiting wallet signature...");
  const res = await signAndExecute(tx);
  return res.digest;
}

// ---------- read owned notes ----------

export async function listNotes(owner) {
  const type = `${CONFIG.knitPackageId}::knit::NoteReceipt`;
  const res = await client.getOwnedObjects({
    owner,
    filter: { StructType: type },
    options: { showContent: true },
  });
  return (res.data ?? []).map((o) => {
    const f = o.data?.content?.fields ?? {};
    return {
      id: o.data?.objectId,
      template: Number(f.template ?? 0),
      costPaid: BigInt(f.cost_paid ?? 0),
      maxPayout: BigInt(f.max_payout ?? 0),
      status: Number(f.status ?? 0),
    };
  });
}

export async function dusdcBalance(owner) {
  const coins = await client.getCoins({ owner, coinType: CONFIG.quoteType });
  return coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
}

// ---------- helpers ----------

async function findCoin(owner, minUnits) {
  const coins = await client.getCoins({ owner, coinType: CONFIG.quoteType });
  const coin = coins.data.find((c) => BigInt(c.balance) >= minUnits);
  if (!coin) throw new Error(`Need a dUSDC coin >= ${fromQuoteUnits(minUnits)} dUSDC. Use the faucet.`);
  return coin.coinObjectId;
}

async function findCreatedObject(digest, typeSuffix) {
  const tx = await client.getTransactionBlock({ digest, options: { showObjectChanges: true } });
  const change = (tx.objectChanges ?? []).find((c) => c.type === "created" && c.objectType.endsWith(typeSuffix));
  if (!change) throw new Error(`No created ${typeSuffix} in ${digest}`);
  return change.objectId;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function u64(tx, value) {
  return tx.pure.u64(value.toString());
}

function decodeU64(bytes) {
  let v = 0n;
  for (let i = 0; i < Math.min(bytes.length, 8); i += 1) v += BigInt(bytes[i]) << (BigInt(i) * 8n);
  return v;
}
