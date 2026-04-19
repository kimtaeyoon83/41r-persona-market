import { z } from 'zod';

// Solana base58 wallet addresses are 32-44 chars. Loose check — full
// validation happens when we hit the chain anyway.
export const walletAddressSchema = z
  .string()
  .trim()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'invalid base58 wallet address');

export const uuidSchema = z.string().uuid();

export const urlSchema = z.string().url().max(2048);

export const txSignatureSchema = z
  .string()
  .trim()
  .min(32)
  .max(120)
  .regex(/^[A-Za-z0-9_]+$/, 'invalid tx signature');
