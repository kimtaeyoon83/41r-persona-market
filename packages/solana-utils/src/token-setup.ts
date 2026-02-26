/**
 * Token-2022 Transfer Fee utilities for 41R Persona Market
 *
 * Creates a Token-2022 mint with a 5% transfer fee. Every transfer
 * automatically withholds fees that can be collected by the withdraw authority.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Signer,
  type TransactionSignature,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeTransferFeeConfigInstruction,
  createInitializeMintInstruction,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getMint,
  getTransferFeeConfig,
  getTransferFeeAmount,
  createTransferCheckedWithFeeInstruction,
  withdrawWithheldTokensFromAccounts,
  harvestWithheldTokensToMint,
  withdrawWithheldTokensFromMint,
  type Account,
  type Mint,
  type TransferFeeConfig,
} from '@solana/spl-token';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Decimals for the 41R token */
export const TOKEN_DECIMALS = 9;

/** Transfer fee in basis points (500 = 5%) */
export const TRANSFER_FEE_BPS = 500;

/** Maximum fee per transfer (in smallest units). Set high to effectively uncap. */
export const MAX_FEE = BigInt(1_000_000_000); // 1 token in base units

/** Solana Explorer base URL (devnet) */
export const EXPLORER_BASE = 'https://explorer.solana.com';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a Solana Explorer link for an address or tx on devnet */
export function explorerUrl(
  addressOrTx: string,
  type: 'address' | 'tx' = 'address',
): string {
  return `${EXPLORER_BASE}/${type}/${addressOrTx}?cluster=devnet`;
}

/** Convert a human-readable token amount to base units */
export function toBaseUnits(amount: number, decimals = TOKEN_DECIMALS): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

/** Convert base units back to a human-readable number */
export function fromBaseUnits(amount: bigint, decimals = TOKEN_DECIMALS): number {
  return Number(amount) / 10 ** decimals;
}

/** Calculate the expected fee for a given transfer amount */
export function calculateExpectedFee(
  transferAmount: bigint,
  feeBps: number = TRANSFER_FEE_BPS,
  maxFee: bigint = MAX_FEE,
): bigint {
  if (feeBps === 0 || transferAmount === 0n) return 0n;
  const numerator = transferAmount * BigInt(feeBps);
  // Ceiling division to match on-chain behavior
  const rawFee = (numerator + 10_000n - 1n) / 10_000n;
  return rawFee > maxFee ? maxFee : rawFee;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Create a Token-2022 mint with Transfer Fee extension.
 *
 * The payer is set as mint authority, freeze authority,
 * transfer fee config authority, and withdraw withheld authority.
 *
 * @returns The mint keypair (public key is the mint address)
 */
export async function createTransferFeeMint(
  connection: Connection,
  payer: Signer,
  options?: {
    decimals?: number;
    feeBps?: number;
    maxFee?: bigint;
    mintKeypair?: Keypair;
  },
): Promise<Keypair> {
  const decimals = options?.decimals ?? TOKEN_DECIMALS;
  const feeBps = options?.feeBps ?? TRANSFER_FEE_BPS;
  const maxFee = options?.maxFee ?? MAX_FEE;
  const mintKeypair = options?.mintKeypair ?? Keypair.generate();

  // Calculate space needed for the mint with TransferFeeConfig extension
  const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const transaction = new Transaction().add(
    // 1. Create the account for the mint
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. Initialize the Transfer Fee Config extension
    //    MUST come before InitializeMint
    createInitializeTransferFeeConfigInstruction(
      mintKeypair.publicKey,
      payer.publicKey, // transferFeeConfigAuthority
      payer.publicKey, // withdrawWithheldAuthority
      feeBps,
      maxFee,
      TOKEN_2022_PROGRAM_ID,
    ),
    // 3. Initialize the mint itself
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      decimals,
      payer.publicKey, // mintAuthority
      payer.publicKey, // freezeAuthority
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  await sendAndConfirmTransaction(connection, transaction, [payer, mintKeypair], {
    commitment: 'confirmed',
  });

  return mintKeypair;
}

/**
 * Create (or get) an Associated Token Account for the given owner
 * under the Token-2022 program.
 */
export async function createTokenAccount(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  owner: PublicKey,
): Promise<Account> {
  return getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner,
    false, // allowOwnerOffCurve
    'confirmed',
    { commitment: 'confirmed' },
    TOKEN_2022_PROGRAM_ID,
  );
}

/**
 * Mint tokens to a destination account.
 * Payer must be the mint authority.
 */
export async function mintTokens(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  destination: PublicKey,
  amount: bigint,
): Promise<TransactionSignature> {
  return mintTo(
    connection,
    payer,
    mint,
    destination,
    payer, // authority (must be mint authority)
    amount,
    [],
    { commitment: 'confirmed' },
    TOKEN_2022_PROGRAM_ID,
  );
}

/**
 * Transfer tokens using `transferCheckedWithFee` (required for Token-2022
 * mints that have the Transfer Fee extension).
 *
 * The fee is calculated automatically and included in the instruction.
 */
export async function transferTokensWithFee(
  connection: Connection,
  payer: Signer,
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: Signer,
  amount: bigint,
  decimals: number = TOKEN_DECIMALS,
  feeBps: number = TRANSFER_FEE_BPS,
  maxFee: bigint = MAX_FEE,
): Promise<TransactionSignature> {
  const fee = calculateExpectedFee(amount, feeBps, maxFee);

  const transaction = new Transaction().add(
    createTransferCheckedWithFeeInstruction(
      source,
      mint,
      destination,
      owner.publicKey,
      amount,
      decimals,
      fee,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  return sendAndConfirmTransaction(connection, transaction, [payer, owner], {
    commitment: 'confirmed',
  });
}

/**
 * Check the withheld fees on a token account.
 */
export async function getWithheldFees(
  connection: Connection,
  tokenAccountAddress: PublicKey,
): Promise<bigint> {
  const account = await getAccount(
    connection,
    tokenAccountAddress,
    'confirmed',
    TOKEN_2022_PROGRAM_ID,
  );
  const feeAmount = getTransferFeeAmount(account);
  return feeAmount?.withheldAmount ?? 0n;
}

/**
 * Harvest withheld fees from token accounts to the mint, then
 * withdraw them from the mint to a destination account.
 *
 * This is the two-step process:
 *   1. harvestWithheldTokensToMint — moves fees from accounts to the mint
 *   2. withdrawWithheldTokensFromMint — moves fees from the mint to a destination
 *
 * Alternatively, you can use withdrawWithheldTokensFromAccounts directly.
 */
export async function collectWithheldFees(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  destination: PublicKey,
  feeSourceAccounts: PublicKey[],
): Promise<{ harvestTx: TransactionSignature; withdrawTx: TransactionSignature }> {
  // Step 1: Harvest fees from accounts into the mint
  const harvestTx = await harvestWithheldTokensToMint(
    connection,
    payer,
    mint,
    feeSourceAccounts,
    { commitment: 'confirmed' },
    TOKEN_2022_PROGRAM_ID,
  );

  // Step 2: Withdraw accumulated fees from the mint to destination
  const withdrawTx = await withdrawWithheldTokensFromMint(
    connection,
    payer,
    mint,
    destination,
    payer, // withdrawWithheldAuthority
    [],
    { commitment: 'confirmed' },
    TOKEN_2022_PROGRAM_ID,
  );

  return { harvestTx, withdrawTx };
}

/**
 * Directly withdraw withheld fees from token accounts to a destination.
 * (Single-step alternative to collectWithheldFees.)
 */
export async function withdrawFeesFromAccounts(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  destination: PublicKey,
  feeSourceAccounts: PublicKey[],
): Promise<TransactionSignature> {
  return withdrawWithheldTokensFromAccounts(
    connection,
    payer,
    mint,
    destination,
    payer, // withdrawWithheldAuthority
    [],
    feeSourceAccounts,
    { commitment: 'confirmed' },
    TOKEN_2022_PROGRAM_ID,
  );
}

/**
 * Fetch the TransferFeeConfig from a mint.
 */
export async function fetchTransferFeeConfig(
  connection: Connection,
  mintAddress: PublicKey,
): Promise<TransferFeeConfig | null> {
  const mintInfo = await getMint(
    connection,
    mintAddress,
    'confirmed',
    TOKEN_2022_PROGRAM_ID,
  );
  return getTransferFeeConfig(mintInfo);
}
