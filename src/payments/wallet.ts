import { Coinbase, Wallet } from '@coinbase/coinbase-sdk';
import { logger } from '../middleware/logger';

let wallet: Wallet | null = null;

export async function initWallet(): Promise<void> {
  const keyId = process.env.COINBASE_API_KEY_ID;
  const keySecret = process.env.COINBASE_API_KEY_SECRET;

  if (!keyId || !keySecret) {
    logger.warn('Coinbase CDP credentials not set — wallet management disabled');
    return;
  }

  try {
    Coinbase.configure({ apiKeyName: keyId, privateKey: keySecret });
    logger.info('Coinbase CDP SDK initialized');
  } catch (err) {
    logger.error('Failed to initialize Coinbase CDP SDK', { err });
  }
}

export async function getOrCreateWallet(): Promise<Wallet | null> {
  if (wallet) return wallet;

  const keyId = process.env.COINBASE_API_KEY_ID;
  if (!keyId) return null;

  try {
    wallet = await Wallet.create({ networkId: process.env.NETWORK ?? 'base-sepolia' });
    logger.info('Wallet created', { address: (await wallet.getDefaultAddress()).getId() });
    return wallet;
  } catch (err) {
    logger.error('Failed to create wallet', { err });
    return null;
  }
}

export function getWalletAddress(): string {
  return process.env.WALLET_ADDRESS ?? '';
}
