import { CdpClient } from '@coinbase/cdp-sdk';
import { logger } from '../middleware/logger';
import { normalizeCdpApiKeySecret } from '../utils/pem';

// Types inferred from CDP SDK v2
type SmartAccount = Awaited<ReturnType<CdpClient['evm']['getOrCreateSmartAccount']>>;

let _cdp: CdpClient | null = null;
let _smartAccount: SmartAccount | null = null;

function getCdpClient(): CdpClient {
  if (!_cdp) {
    _cdp = new CdpClient({
      apiKeyId: process.env.CDP_API_KEY_ID,
      apiKeySecret: normalizeCdpApiKeySecret(process.env.CDP_API_KEY_SECRET),
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
      assertPayToMatchesSmartAccount(smartAccount.address);
    }
  } catch (err) {
    logger.error('Failed to initialize CDP smart account', { err });
  }
}

/**
 * The paywall advertises `WALLET_ADDRESS` as the x402 payTo on every route
 * (see src/config/x402-bazaar-config.ts#getPayTo), so if the live smart
 * account's address differs, mainnet customers pay to an address we don't
 * control from this process. In production we refuse to continue; in dev we
 * warn, because mismatch is a frequent setup intermediate.
 */
function assertPayToMatchesSmartAccount(smartAccountAddress: string): void {
  const configured = (process.env.WALLET_ADDRESS ?? '').toLowerCase();
  const actual = smartAccountAddress.toLowerCase();
  if (!configured || configured === actual) return;

  const detail = `WALLET_ADDRESS=${configured} does not match live smart account ${actual}`;
  if (process.env.NODE_ENV === 'production') {
    logger.error('Fatal payTo mismatch — refusing to serve', {
      event: 'wallet_address_mismatch',
      configured,
      actual,
    });
    console.error(`[FATAL] ${detail}. Set WALLET_ADDRESS=${actual} and restart.`);
    process.exit(1);
  }
  logger.warn('WALLET_ADDRESS does not match the live smart account', {
    event: 'wallet_address_mismatch',
    configured,
    actual,
    hint: `Set WALLET_ADDRESS=${actual} to collect payments on the correct address.`,
  });
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
