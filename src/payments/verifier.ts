import { ethers } from 'ethers';
import { logger } from '../middleware/logger';

let provider: ethers.JsonRpcProvider | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(
      process.env.BASE_RPC_URL ?? 'https://sepolia.base.org'
    );
  }
  return provider;
}

// Minimal ERC-20 ABI for balance/transfer checking
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

export async function verifyUSDCBalance(
  agentAddress: string,
  requiredAmount: bigint
): Promise<boolean> {
  try {
    const usdcContract = new ethers.Contract(
      process.env.USDC_CONTRACT ?? '',
      ERC20_ABI,
      getProvider()
    );
    const balance: bigint = await usdcContract.balanceOf(agentAddress);
    return balance >= requiredAmount;
  } catch (err) {
    logger.error('Failed to verify USDC balance', { agentAddress, err });
    return false;
  }
}

export async function verifyTransactionOnChain(txHash: string): Promise<{
  valid: boolean;
  from?: string;
  to?: string;
  amount?: bigint;
}> {
  try {
    const prov = getProvider();
    const receipt = await prov.getTransactionReceipt(txHash);

    if (!receipt || receipt.status !== 1) {
      return { valid: false };
    }

    // Parse Transfer event from USDC contract
    const usdcInterface = new ethers.Interface(ERC20_ABI);
    const usdcAddress = (process.env.USDC_CONTRACT ?? '').toLowerCase();

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== usdcAddress) continue;
      try {
        const parsed = usdcInterface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === 'Transfer') {
          return {
            valid: true,
            from: parsed.args[0] as string,
            to: parsed.args[1] as string,
            amount: parsed.args[2] as bigint,
          };
        }
      } catch {
        continue;
      }
    }

    return { valid: false };
  } catch (err) {
    logger.error('Failed to verify transaction on-chain', { txHash, err });
    return { valid: false };
  }
}
