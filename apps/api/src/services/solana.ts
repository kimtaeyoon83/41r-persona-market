import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import {
  createTokenAccount,
  mintTokens,
  transferTokensWithFee,
  toBaseUnits,
  explorerUrl,
} from '@41rpm/solana-utils';
import fs from 'fs';
import path from 'path';

export class InsufficientFundsError extends Error {
  constructor(
    public readonly needed: number,
    public readonly available: number,
    public readonly mint: string,
  ) {
    super(
      `Payer wallet has insufficient funds: needed ${needed}, available ${available} (mint ${mint})`,
    );
    this.name = 'InsufficientFundsError';
  }
}

class SolanaService {
  private connection: Connection;
  private payer: Keypair;
  private mintAddress?: PublicKey;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Load keypair from env var (JSON string) or file
    try {
      let secretKey: number[];
      if (process.env.SOLANA_KEYPAIR_JSON) {
        secretKey = JSON.parse(process.env.SOLANA_KEYPAIR_JSON);
      } else {
        const keypairPath = process.env.SOLANA_KEYPAIR_PATH?.replace('~', process.env.HOME || '')
          || path.join(process.env.HOME || '', '.config', 'solana', 'id.json');
        secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      }
      this.payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } catch {
      console.warn('[Solana] No keypair found, using random keypair');
      this.payer = Keypair.generate();
    }

    // Load 41R Token mint from env
    const mintEnv = process.env.TOKEN_41R_MINT;
    if (mintEnv) {
      this.mintAddress = new PublicKey(mintEnv);
      console.log(`[Solana] 41R Token mint loaded: ${this.mintAddress.toBase58()}`);
    }
  }

  get payerPublicKey(): PublicKey {
    return this.payer.publicKey;
  }

  /**
   * Read the current USDC balance of the payer wallet. Used as a
   * preflight before reward disbursement so we fail fast with a
   * structured error instead of submitting a doomed transaction.
   *
   * Returns the balance in whole USDC (not base units).
   */
  async getPayerUsdcBalance(usdcMint?: string): Promise<number> {
    const mint = new PublicKey(
      usdcMint || process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    );
    const ata = await getOrCreateAssociatedTokenAccount(
      this.connection, this.payer, mint, this.payer.publicKey,
    );
    const bal = await this.connection.getTokenAccountBalance(ata.address);
    return Number(bal.value.uiAmount ?? 0);
  }

  // Transfer USDC to a tester (manual test reward)
  async transferUsdc(
    recipientWallet: string,
    amountUsdc: number,
    usdcMint?: string,
  ): Promise<{ txSignature: string; explorerUrl: string }> {
    const mint = new PublicKey(usdcMint || process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    const recipient = new PublicKey(recipientWallet);

    // Get or create source and destination ATAs
    const sourceAta = await getOrCreateAssociatedTokenAccount(
      this.connection, this.payer, mint, this.payer.publicKey,
    );
    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection, this.payer, mint, recipient,
    );

    // Preflight: fail fast with a structured error if the payer can't
    // cover this transfer. Without this, the RPC would still reject the
    // tx but with a generic simulation error that's harder to diagnose
    // at 300-tester scale.
    const bal = await this.connection.getTokenAccountBalance(sourceAta.address);
    const available = Number(bal.value.uiAmount ?? 0);
    if (available < amountUsdc) {
      throw new InsufficientFundsError(amountUsdc, available, mint.toBase58());
    }

    // USDC has 6 decimals
    const amount = BigInt(Math.round(amountUsdc * 1_000_000));

    const tx = new Transaction().add(
      createTransferCheckedInstruction(
        sourceAta.address,
        mint,
        destAta.address,
        this.payer.publicKey,
        amount,
        6, // USDC decimals
      ),
    );

    const txSignature = await sendAndConfirmTransaction(this.connection, tx, [this.payer]);

    return {
      txSignature,
      explorerUrl: explorerUrl(txSignature, 'tx'),
    };
  }

  // Mint 41R tokens (auto test settlement)
  async mint41RTokens(
    recipientWallet: string,
    amount: number,
  ): Promise<{ txSignature: string; explorerUrl: string }> {
    if (!this.mintAddress) {
      throw new Error('41R Token mint not initialized. Run setup-token first.');
    }

    const recipient = new PublicKey(recipientWallet);
    const destAta = await createTokenAccount(this.connection, this.payer, this.mintAddress, recipient);
    const baseAmount = toBaseUnits(amount);

    const txSignature = await mintTokens(
      this.connection, this.payer, this.mintAddress, destAta.address, baseAmount,
    );

    return {
      txSignature,
      explorerUrl: explorerUrl(txSignature, 'tx'),
    };
  }

  // Transfer 41R tokens with fee (triggers Transfer Hook)
  async transfer41RTokens(
    fromWallet: string,
    toWallet: string,
    amount: number,
  ): Promise<{ txSignature: string; fee: number; explorerUrl: string }> {
    if (!this.mintAddress) {
      throw new Error('41R Token mint not initialized');
    }

    const from = new PublicKey(fromWallet);
    const to = new PublicKey(toWallet);

    const sourceAta = await createTokenAccount(this.connection, this.payer, this.mintAddress, from);
    const destAta = await createTokenAccount(this.connection, this.payer, this.mintAddress, to);

    const baseAmount = toBaseUnits(amount);
    const txSignature = await transferTokensWithFee(
      this.connection, this.payer, sourceAta.address, this.mintAddress, destAta.address, this.payer, baseAmount,
    );

    const feeAmount = amount * 0.05; // 5% transfer fee

    return {
      txSignature,
      fee: feeAmount,
      explorerUrl: explorerUrl(txSignature, 'tx'),
    };
  }

  // Set the mint address (after token creation)
  setMintAddress(mint: string): void {
    this.mintAddress = new PublicKey(mint);
  }

  // Get SOL balance
  async getBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.payer.publicKey);
    return balance / 1_000_000_000; // lamports to SOL
  }
}

// Singleton instance
export const solanaService = new SolanaService();
