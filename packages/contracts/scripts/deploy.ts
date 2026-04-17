import { ethers, network, run } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`[deploy] network: ${network.name} (chainId=${network.config.chainId})`);
  console.log(`[deploy] deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[deploy] balance: ${ethers.formatEther(balance)} native`);
  if (balance === 0n) {
    throw new Error('Deployer has zero native balance — fund it first.');
  }

  console.log('[deploy] compiling...');
  await run('compile');

  console.log('[deploy] deploying MockUSDC...');
  const factory = await ethers.getContractFactory('MockUSDC');
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();
  console.log(`[deploy] MockUSDC deployed at ${address}`);
  if (tx) console.log(`[deploy] tx: ${tx.hash}`);

  console.log('\n[deploy] add to root .env:');
  console.log(`  BSC_MOCKUSDC_ADDRESS=${address}`);
  console.log(`  NEXT_PUBLIC_BSC_MOCKUSDC_ADDRESS=${address}`);

  if (network.name === 'bscTestnet' && process.env.BSCSCAN_API_KEY) {
    console.log('\n[deploy] waiting 20s for block indexing before verify...');
    await new Promise((r) => setTimeout(r, 20_000));
    try {
      await run('verify:verify', { address, constructorArguments: [] });
      console.log('[deploy] verified on BscScan');
    } catch (err) {
      console.warn('[deploy] verify skipped:', err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
