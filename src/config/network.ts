// Single source of truth for all network-derived constants.
// Every other module imports from here — no scattered ternaries or env var lookups.

export type NetworkName = 'base-mainnet' | 'base-sepolia';

interface NetworkConfig {
  chainId: `${string}:${string}`;
  chainIdNum: number;
  usdcContract: string;
  label: string;
  isMainnet: boolean;
}

const NETWORKS: Record<NetworkName, NetworkConfig> = {
  'base-mainnet': {
    chainId: 'eip155:8453',
    chainIdNum: 8453,
    usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    label: 'Base Mainnet',
    isMainnet: true,
  },
  'base-sepolia': {
    chainId: 'eip155:84532',
    chainIdNum: 84532,
    usdcContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    label: 'Base Sepolia (testnet)',
    isMainnet: false,
  },
};

function resolveNetwork(): NetworkName {
  const env = process.env.NETWORK ?? 'base-sepolia';
  return env in NETWORKS ? (env as NetworkName) : 'base-sepolia';
}

export function getNetworkConfig(): NetworkConfig {
  return NETWORKS[resolveNetwork()];
}

export function isMainnet(): boolean {
  return getNetworkConfig().isMainnet;
}

export function getChainId(): `${string}:${string}` {
  return getNetworkConfig().chainId;
}

export function getUsdcContract(): string {
  return getNetworkConfig().usdcContract;
}

export function getNetworkLabel(): string {
  return getNetworkConfig().label;
}

export const FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';
export const BAZAAR_DISCOVERY_URL = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
