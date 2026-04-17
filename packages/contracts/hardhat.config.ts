import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

dotenv.config({ path: '../../.env' });

function resolveDeployerKey(): string | undefined {
  if (process.env.DEPLOYER_PRIVATE_KEY) return process.env.DEPLOYER_PRIVATE_KEY;
  const fallback = path.resolve(__dirname, '../../.keys/bsc-deployer.json');
  if (fs.existsSync(fallback)) {
    try {
      return JSON.parse(fs.readFileSync(fallback, 'utf-8')).privateKey;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const DEPLOYER_PRIVATE_KEY = resolveDeployerKey();
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY ?? '';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    bscTestnet: {
      url: process.env.BSC_RPC_URL ?? 'https://data-seed-prebsc-1-s1.binance.org:8545',
      chainId: 97,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      bscTestnet: BSCSCAN_API_KEY,
    },
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
};

export default config;
