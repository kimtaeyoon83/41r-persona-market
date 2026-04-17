import { ethers } from 'hardhat';
import fs from 'node:fs';
import path from 'node:path';

const outPath = process.argv[2] ?? path.resolve(__dirname, '../../../.keys/bsc-deployer.json');

if (fs.existsSync(outPath)) {
  console.error(`[generate-wallet] ${outPath} already exists. Delete it first if you really want to regenerate.`);
  process.exit(1);
}

const wallet = (ethers as unknown as { Wallet: { createRandom(): { address: string; privateKey: string; mnemonic: { phrase: string } | null } } }).Wallet.createRandom();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic?.phrase ?? null,
      createdAt: new Date().toISOString(),
      network: 'bsc-testnet',
      purpose: 'deployer + facilitator for MockUSDC x402 demo',
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

console.log('\nGenerated wallet:');
console.log(`  address:  ${wallet.address}`);
console.log(`  file:     ${outPath}`);
console.log('\nFund this address with tBNB:');
console.log('  https://www.bnbchain.org/en/testnet-faucet');
console.log('\nAdd to root .env (do NOT commit):');
console.log(`  DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`);
console.log(`  EVM_FACILITATOR_PRIVATE_KEY=${wallet.privateKey}`);
console.log(`  X402_EVM_RESOURCE_WALLET=${wallet.address}`);
