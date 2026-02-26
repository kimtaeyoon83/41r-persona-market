#!/usr/bin/env npx tsx
/**
 * 41R Token-2022 Transfer Fee PoC — Setup Script
 *
 * Run with: npx tsx scripts/setup-token.ts
 *
 * What it does:
 *   1. Loads your Solana keypair from ~/.config/solana/id.json
 *   2. Requests a devnet airdrop if balance is low
 *   3. Creates a Token-2022 mint with 5% transfer fee
 *   4. Creates 2 token accounts (sender + receiver)
 *   5. Mints 100 tokens to the sender
 *   6. Transfers 10 tokens from sender to receiver
 *   7. Verifies the receiver got ~9.5 tokens and ~0.5 was withheld as fee
 *   8. Withdraws withheld fees
 *   9. Prints all results with Solana Explorer links
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';

import {
  TOKEN_DECIMALS,
  TRANSFER_FEE_BPS,
  MAX_FEE,
  createTransferFeeMint,
  createTokenAccount,
  mintTokens,
  transferTokensWithFee,
  getWithheldFees,
  withdrawFeesFromAccounts,
  fetchTransferFeeConfig,
  toBaseUnits,
  fromBaseUnits,
  calculateExpectedFee,
  explorerUrl,
} from '../packages/solana-utils/src/index.js';

import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
} from '@solana/spl-token';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Load .env from project root
const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const KEYPAIR_PATH = (process.env.SOLANA_KEYPAIR_PATH || '~/.config/solana/id.json')
  .replace('~', process.env.HOME || '');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKeypair(path: string): Keypair {
  try {
    const raw = readFileSync(path, 'utf-8');
    const secretKey = Uint8Array.from(JSON.parse(raw));
    return Keypair.fromSecretKey(secretKey);
  } catch (err) {
    console.error(`\n[ERROR] Could not load keypair from: ${path}`);
    console.error('Make sure you have run:');
    console.error('  solana-keygen new --no-bip39-passphrase');
    console.error('  solana config set --url devnet\n');
    process.exit(1);
  }
}

function divider(title: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

async function ensureBalance(connection: Connection, keypair: Keypair) {
  const balance = await connection.getBalance(keypair.publicKey);
  const solBalance = balance / LAMPORTS_PER_SOL;
  console.log(`  Wallet balance: ${solBalance.toFixed(4)} SOL`);

  if (solBalance < 0.5) {
    console.log('  Balance is low. Requesting airdrop...');
    try {
      const sig = await connection.requestAirdrop(keypair.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      const newBalance = await connection.getBalance(keypair.publicKey);
      console.log(`  New balance: ${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    } catch (err) {
      console.error('\n[ERROR] Airdrop failed. Devnet faucet may be rate-limited.');
      console.error('You can request SOL manually at:');
      console.error('  https://faucet.solana.com/');
      console.error(`  Wallet: ${keypair.publicKey.toBase58()}\n`);
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  divider('41R Token-2022 Transfer Fee PoC');

  // --- Load wallet ---
  console.log(`\n  Loading keypair from: ${KEYPAIR_PATH}`);
  const payer = loadKeypair(KEYPAIR_PATH);
  console.log(`  Wallet: ${payer.publicKey.toBase58()}`);
  console.log(`  ${explorerUrl(payer.publicKey.toBase58())}`);

  // --- Connect ---
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`  RPC: ${RPC_URL}`);

  // --- Ensure balance ---
  await ensureBalance(connection, payer);

  // --- Step 1: Create mint ---
  divider('Step 1: Create Token-2022 Mint (5% Transfer Fee)');
  console.log(`  Fee: ${TRANSFER_FEE_BPS} bps (${TRANSFER_FEE_BPS / 100}%)`);
  console.log(`  Max fee: ${fromBaseUnits(MAX_FEE)} tokens`);
  console.log(`  Decimals: ${TOKEN_DECIMALS}`);
  console.log('  Creating mint...');

  const mintKeypair = await createTransferFeeMint(connection, payer);
  const mint = mintKeypair.publicKey;

  console.log(`  Mint created: ${mint.toBase58()}`);
  console.log(`  ${explorerUrl(mint.toBase58())}`);

  // Verify the fee config
  const feeConfig = await fetchTransferFeeConfig(connection, mint);
  if (feeConfig) {
    console.log(`  Fee config verified on-chain:`);
    console.log(`    transferFeeBasisPoints: ${feeConfig.newerTransferFee.transferFeeBasisPoints}`);
    console.log(`    maximumFee: ${feeConfig.newerTransferFee.maximumFee}`);
  }

  // --- Step 2: Create token accounts ---
  divider('Step 2: Create Token Accounts');

  // Use the payer as the sender
  const senderOwner = payer.publicKey;
  // Generate a new keypair for the receiver
  const receiverKeypair = Keypair.generate();
  const receiverOwner = receiverKeypair.publicKey;

  console.log(`  Sender owner:   ${senderOwner.toBase58()}`);
  console.log(`  Receiver owner: ${receiverOwner.toBase58()}`);

  console.log('  Creating sender ATA...');
  const senderAccount = await createTokenAccount(connection, payer, mint, senderOwner);
  console.log(`  Sender ATA: ${senderAccount.address.toBase58()}`);
  console.log(`  ${explorerUrl(senderAccount.address.toBase58())}`);

  console.log('  Creating receiver ATA...');
  const receiverAccount = await createTokenAccount(connection, payer, mint, receiverOwner);
  console.log(`  Receiver ATA: ${receiverAccount.address.toBase58()}`);
  console.log(`  ${explorerUrl(receiverAccount.address.toBase58())}`);

  // --- Step 3: Mint tokens ---
  divider('Step 3: Mint 100 Tokens to Sender');

  const mintAmount = toBaseUnits(100);
  console.log(`  Amount: 100 tokens (${mintAmount} base units)`);
  console.log('  Minting...');

  const mintTxSig = await mintTokens(connection, payer, mint, senderAccount.address, mintAmount);
  console.log(`  Mint tx: ${mintTxSig}`);
  console.log(`  ${explorerUrl(mintTxSig, 'tx')}`);

  // --- Step 4: Transfer 10 tokens ---
  divider('Step 4: Transfer 10 Tokens (Sender -> Receiver)');

  const transferAmount = toBaseUnits(10);
  const expectedFee = calculateExpectedFee(transferAmount);
  const expectedReceived = transferAmount - expectedFee;

  console.log(`  Transfer amount: 10 tokens (${transferAmount} base units)`);
  console.log(`  Expected fee (5%): ${fromBaseUnits(expectedFee)} tokens (${expectedFee} base units)`);
  console.log(`  Expected received: ${fromBaseUnits(expectedReceived)} tokens`);
  console.log('  Transferring...');

  const transferTxSig = await transferTokensWithFee(
    connection,
    payer,
    senderAccount.address,
    mint,
    receiverAccount.address,
    payer, // owner of sender account
    transferAmount,
  );
  console.log(`  Transfer tx: ${transferTxSig}`);
  console.log(`  ${explorerUrl(transferTxSig, 'tx')}`);

  // --- Step 5: Verify balances ---
  divider('Step 5: Verify Balances & Fees');

  // Re-fetch accounts
  const senderInfo = await getAccount(connection, senderAccount.address, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const receiverInfo = await getAccount(connection, receiverAccount.address, 'confirmed', TOKEN_2022_PROGRAM_ID);

  const senderBalance = fromBaseUnits(senderInfo.amount);
  const receiverBalance = fromBaseUnits(receiverInfo.amount);

  console.log(`  Sender balance:   ${senderBalance} tokens (expected: 90)`);
  console.log(`  Receiver balance: ${receiverBalance} tokens (expected: ${fromBaseUnits(expectedReceived)})`);

  // Check withheld fees on receiver account
  const withheldOnReceiver = await getWithheldFees(connection, receiverAccount.address);
  console.log(`  Withheld on receiver: ${fromBaseUnits(withheldOnReceiver)} tokens`);

  // Verify
  const senderOk = senderInfo.amount === mintAmount - transferAmount;
  const receiverOk = receiverInfo.amount === expectedReceived;
  const feeOk = withheldOnReceiver === expectedFee;

  console.log(`\n  Sender balance correct:   ${senderOk ? 'YES' : 'NO'}`);
  console.log(`  Receiver balance correct: ${receiverOk ? 'YES' : 'NO'}`);
  console.log(`  Fee withheld correct:     ${feeOk ? 'YES' : 'NO'}`);

  if (senderOk && receiverOk && feeOk) {
    console.log('\n  ALL CHECKS PASSED!');
  } else {
    console.log('\n  SOME CHECKS FAILED — see above');
  }

  // --- Step 6: Withdraw fees ---
  divider('Step 6: Withdraw Withheld Fees');

  console.log('  Withdrawing fees from receiver account to sender account...');

  const withdrawTxSig = await withdrawFeesFromAccounts(
    connection,
    payer,
    mint,
    senderAccount.address, // send collected fees to sender (the authority)
    [receiverAccount.address],
  );
  console.log(`  Withdraw tx: ${withdrawTxSig}`);
  console.log(`  ${explorerUrl(withdrawTxSig, 'tx')}`);

  // Verify fees were collected
  const withheldAfter = await getWithheldFees(connection, receiverAccount.address);
  const senderAfterWithdraw = await getAccount(connection, senderAccount.address, 'confirmed', TOKEN_2022_PROGRAM_ID);

  console.log(`  Withheld on receiver after withdraw: ${fromBaseUnits(withheldAfter)} tokens`);
  console.log(`  Sender balance after fee collection: ${fromBaseUnits(senderAfterWithdraw.amount)} tokens`);

  // --- Summary ---
  divider('Summary');
  console.log(`  Mint:             ${mint.toBase58()}`);
  console.log(`  Sender ATA:       ${senderAccount.address.toBase58()}`);
  console.log(`  Receiver ATA:     ${receiverAccount.address.toBase58()}`);
  console.log(`  Transfer Fee:     ${TRANSFER_FEE_BPS / 100}%`);
  console.log(`  Transfer Amount:  10 tokens`);
  console.log(`  Fee Collected:    ${fromBaseUnits(expectedFee)} tokens`);
  console.log(`  Receiver Got:     ${fromBaseUnits(expectedReceived)} tokens`);
  console.log(`\n  Explorer links:`);
  console.log(`    Mint:     ${explorerUrl(mint.toBase58())}`);
  console.log(`    Sender:   ${explorerUrl(senderAccount.address.toBase58())}`);
  console.log(`    Receiver: ${explorerUrl(receiverAccount.address.toBase58())}`);
  console.log('');
}

main().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
