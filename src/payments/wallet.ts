import { CdpClient } from '@coinbase/cdp-sdk';
import { logger } from '../middleware/logger';
import { createPrivateKey } from 'crypto';

// Types inferred from CDP SDK v2
type SmartAccount = Awaited<ReturnType<CdpClient['evm']['getOrCreateSmartAccount']>>;

let _cdp: CdpClient | null = null;
let _smartAccount: SmartAccount | null = null;

/**
 * Normalizes the CDP API key secret:
 * 1. Replaces literal \n with real newlines (for env vars stored on one line)
 * 2. Converts SEC1 EC key (-----BEGIN EC PRIVATE KEY-----) to PKCS#8
 *    (-----BEGIN PRIVATE KEY-----) which the CDP SDK's jose library requires
 */
function normalizeApiKeySecret(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const pem = raw.replace(/\\n/g, '\n');
  if (pem.includes('-----BEGIN EC PRIVATE KEY-----')) {
    const pkcs8 = createPrivateKey({ key: pem, format: 'pem' })
      .export({ type: 'pkcs8', format: 'pem' }) as string;
    return pkcs8;
  }
  return pem;
}

function getCdpClient(): CdpClient {
  if (!_cdp) {
    _cdp = new CdpClient({
      apiKeyId: process.env.CDP_API_KEY_ID,
      apiKeySecret: normalizeApiKeySecret(process.env.CDP_API_KEY_SECRET),
      walletSecret: process.env.CDP_WALLET_SECRET,
    });
  }
  return _cdp;
}

export async function initWallet(): Promise<void> {
  const keyId = process.env.CDP_API_KEY_ID;
  const keySecret = process.env.CDP_API_KEY_SECRET;
  const walletSecret = process.env.CDP_WALLET_SECRET;

  if (!keyId || !keySecret || !walletSecret) {
    logger.warn('CDP credentials not set (CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET) — wallet management disabled');
    return;
  }

  try {
    const smartAccount = await getOrCreateSmartAccount();
    if (smartAccount) {
      logger.info('Smart account initialized', { address: smartAccount.address });
    }
  } catch (err) {
    logger.error('Failed to initialize CDP smart account', { err });
  }
}

export async function getOrCreateSmartAccount(): Promise<SmartAccount | null> {
  if (_smartAccount) return _smartAccount;

  const keyId = process.env.CDP_API_KEY_ID;
  if (!keyId) return null;

  try {
    const cdp = getCdpClient();

    // Step 1: Persistent named EOA — same address on every run
    const owner = await cdp.evm.getOrCreateAccount({ name: 'agent-owner' });
    logger.info('Owner EOA ready', { address: owner.address });

    // Step 2: ERC-4337 smart contract wallet owned by the EOA
    _smartAccount = await cdp.evm.getOrCreateSmartAccount({ name: 'agent-smart-account', owner });
    logger.info('Smart account ready', { address: _smartAccount.address });

    return _smartAccount;
  } catch (err) {
    logger.error('Failed to create smart account', { err });
    return null;
  }
}

export function getWalletAddress(): string {
  // Prefer the live smart account address; fall back to WALLET_ADDRESS env var
  return _smartAccount?.address ?? process.env.WALLET_ADDRESS ?? '';
}
