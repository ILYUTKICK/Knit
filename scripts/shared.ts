// Shared helpers for the smoke scripts: Sui client config, keypair loading,
// oracle selection, strike rounding, and devInspect output formatting.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SuiClient } from "@mysten/sui/client";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { TESTNET_CONFIG } from "../packages/core/src/config.ts";

export type SuiConfig = {
  activeAddress: string;
  activeEnv: string;
  rpcUrl: string;
  keystorePath: string;
};

export type OracleSummary = {
  oracle_id: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: string;
};

export type OracleState = {
  oracle: OracleSummary;
  latest_price?: { spot: number; forward: number };
  ask_bounds?: { min_ask_price?: number; max_ask_price?: number } | null;
};

export async function readSuiConfig(): Promise<SuiConfig> {
  const configPath = join(homedir(), ".sui/sui_config/client.yaml");
  const raw = await readFile(configPath, "utf8");
  const activeEnv = mustMatch(raw, /active_env:\s*([^\n]+)/, "active_env").replaceAll('"', "").trim();
  const activeAddress = mustMatch(raw, /active_address:\s*"([^"]+)"/, "active_address").trim();
  const keystorePath = mustMatch(raw, /File:\s*([^\n]+)/, "keystore File").trim();
  const envBlock = raw.split(`alias: ${activeEnv}`)[1] ?? raw;
  const rpcUrl = mustMatch(envBlock, /rpc:\s*"([^"]+)"/, "active env rpc").trim();
  return { activeAddress, activeEnv, rpcUrl, keystorePath };
}

export async function loadActiveEd25519Keypair(config: SuiConfig): Promise<Ed25519Keypair> {
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

export async function pickActiveBtcOracle(minExpiryBufferMs: number): Promise<OracleState> {
  const minExpiry = Date.now() + minExpiryBufferMs;
  const oracles = await fetchJson<OracleSummary[]>(
    `${TESTNET_CONFIG.predictServerUrl}/predicts/${TESTNET_CONFIG.predictObjectId}/oracles`,
  );
  const active = oracles
    .filter((o) => o.underlying_asset === "BTC" && o.status === "active" && o.expiry > minExpiry)
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

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export function roundToGrid(value: bigint, min: bigint, tick: bigint): bigint {
  if (value <= min) return min;
  const ticks = (value - min + tick / 2n) / tick;
  return min + ticks * tick;
}

export function printDevInspect(
  label: string,
  result: Awaited<ReturnType<SuiClient["devInspectTransactionBlock"]>>,
) {
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

export function formatOraclePrice(value: bigint): string {
  const scale = 1_000_000_000n;
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function mustMatch(raw: string, pattern: RegExp, label: string): string {
  const match = raw.match(pattern);
  if (!match) throw new Error(`Could not parse ${label} from Sui client config`);
  return match[1];
}
