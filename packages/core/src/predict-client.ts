import { TESTNET_CONFIG } from "./config.ts";

export type PredictOracleSummary = {
  id?: string;
  oracle_id?: string;
  underlying_asset?: string;
  expiry?: number | string;
  status?: string | number;
  [key: string]: unknown;
};

export type OracleState = {
  id?: string;
  oracle_id?: string;
  underlying_asset?: string;
  expiry?: number | string;
  spot?: number | string;
  forward?: number | string;
  status?: string | number;
  [key: string]: unknown;
};

export type AskBounds = {
  min_ask_price?: number | string;
  max_ask_price?: number | string;
  [key: string]: unknown;
};

export class PredictClient {
  readonly baseUrl: string;

  constructor(baseUrl = TESTNET_CONFIG.predictServerUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  status(): Promise<unknown> {
    return this.get("/status");
  }

  listOracles(predictId = TESTNET_CONFIG.predictObjectId): Promise<PredictOracleSummary[]> {
    return this.get(`/predicts/${predictId}/oracles`);
  }

  oracleState(oracleId: string): Promise<OracleState> {
    return this.get(`/oracles/${oracleId}/state`);
  }

  askBounds(oracleId: string): Promise<AskBounds> {
    return this.get(`/oracles/${oracleId}/ask-bounds`);
  }

  oraclePrices(oracleId: string): Promise<unknown> {
    return this.get(`/oracles/${oracleId}/prices`);
  }

  managerPositions(managerId: string): Promise<unknown> {
    return this.get(`/managers/${managerId}/positions/summary`);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Predict server ${path} failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }
}
