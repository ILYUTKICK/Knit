export const TESTNET_CONFIG = {
  network: "testnet",
  predictServerUrl: "https://predict-server.testnet.mystenlabs.com",
  predictPackageId: "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138",
  predictRegistryId: "0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64",
  predictObjectId: "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a",
  quoteType: "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC",
  quoteDecimals: 6,
  floatScaling: 1_000_000_000n,
} as const;

export const TEMPLATE_IDS = {
  range: 0,
  breakout: 1,
  ladder: 2,
} as const;

export type KnitDeployment = {
  packageId: string;
  registryId: string;
};
