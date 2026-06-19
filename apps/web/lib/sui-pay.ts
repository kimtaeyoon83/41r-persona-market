// Client-side Sui USDC escrow payment (chain wiring §4.3).
//
// Builds the create-escrow PTB the user signs (via Privy → lib/sui-wallet.ts):
// split USDC → campaign::create<USDC> → transfer the owner cap to the operator
// (the §6 verification anchor) so the server can settle/close. Everything the
// PTB needs (amount, coin type, package id, cap recipient, target, criteria)
// comes from the escrow envelope the server returns from POST /api/scan.

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";

const SUI_RPC_URL =
  process.env.NEXT_PUBLIC_SUI_RPC_URL || "https://fullnode.testnet.sui.io:443";
const SUI_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK || "testnet") as
  | "testnet"
  | "mainnet"
  | "devnet"
  | "localnet";

/** Circle native USDC on Sui (default testnet). Mirrors api env
 *  SUI_USDC_COIN_TYPE — keep in sync. */
export const USDC_COIN_TYPE =
  process.env.NEXT_PUBLIC_SUI_USDC_COIN_TYPE ||
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

let _client: SuiJsonRpcClient | null = null;
export function suiClient(): SuiJsonRpcClient {
  if (!_client) _client = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });
  return _client;
}

/** USDC balance (base units, 6 dp) for an owner. */
export async function getUsdcBalance(owner: string, coinType: string): Promise<bigint> {
  const b = await suiClient().getBalance({ owner, coinType });
  return BigInt(b.totalBalance);
}

/** The payment envelope returned by POST /api/scan when payment_method=usdc. */
export type EscrowEnvelope = {
  usdc_amount: string;
  coin_type: string;
  cap_recipient: string;
  package_id: string;
  target: string;
  criteria: string;
};

/**
 * Build the create-escrow PTB. The signer (the user via Privy) owns the USDC.
 * Throws a user-facing message when the wallet has no / insufficient USDC.
 */
export async function buildCreateUsdcCampaignTx(
  sender: string,
  env: EscrowEnvelope,
): Promise<Transaction> {
  const client = suiClient();
  const amount = BigInt(env.usdc_amount);
  const coins = await client.getCoins({ owner: sender, coinType: env.coin_type });
  if (!coins.data.length) {
    throw new Error("No USDC in your Sui wallet — get testnet USDC at faucet.circle.com");
  }
  const total = coins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
  if (total < amount) {
    throw new Error(`Insufficient USDC (need ${Number(amount) / 1e6}, have ${Number(total) / 1e6})`);
  }

  const tx = new Transaction();
  const primary = coins.data[0]!.coinObjectId;
  if (coins.data.length > 1) {
    tx.mergeCoins(
      tx.object(primary),
      coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }
  const [pay] = tx.splitCoins(tx.object(primary), [tx.pure.u64(amount)]);
  const cap = tx.moveCall({
    target: `${env.package_id}::campaign::create`,
    typeArguments: [env.coin_type],
    arguments: [
      pay,
      tx.pure.string(env.target),
      tx.pure.string(env.criteria),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  tx.transferObjects([cap], tx.pure.address(env.cap_recipient));
  tx.setSender(sender);
  return tx;
}
