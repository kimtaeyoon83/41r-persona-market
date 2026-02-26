import { Request, Response, NextFunction } from 'express';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

// Wallet signature verification middleware
// For hackathon: simplified — just checks the wallet address is valid
// In production: verify SIWS (Sign-In with Solana) signature
export function walletAuth(req: Request, res: Response, next: NextFunction): void {
  const walletAddress = req.headers['x-wallet-address'] as string;

  if (!walletAddress) {
    res.status(401).json({ error: 'Missing x-wallet-address header' });
    return;
  }

  // Validate it's a valid Solana public key
  try {
    new PublicKey(walletAddress);
  } catch {
    res.status(401).json({ error: 'Invalid wallet address' });
    return;
  }

  // Attach wallet to request
  (req as Request & { wallet: string }).wallet = walletAddress;
  next();
}

// Full signature verification (for production)
export function verifySignature(
  message: string,
  signature: string,
  publicKey: string,
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = Buffer.from(signature, 'base64');
    const publicKeyBytes = new PublicKey(publicKey).toBytes();
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch {
    return false;
  }
}
