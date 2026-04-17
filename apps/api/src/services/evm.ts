/**
 * EVM service — viem clients + MockUSDC helpers for BSC testnet (chainId 97).
 *
 * The x402/evm library's v1 network map does not include BSC, so we wire
 * verification + settlement ourselves. The payload shape is intentionally
 * kept compatible with the x402 exact EVM scheme (ExactEIP3009Payload).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  getContract,
  verifyTypedData,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';

/** EIP-3009 authorization (matches @x402/evm ExactEIP3009Payload.authorization). */
export interface Eip3009Authorization {
  from: Address;
  to: Address;
  value: string; // uint256 as decimal string, in USDC smallest units
  validAfter: string;
  validBefore: string;
  nonce: Hex; // 32-byte hex
}

/** x402 `X-Payment` payload. */
export interface X402EvmPayment {
  x402Version: 1;
  scheme: 'exact';
  network: string; // CAIP-2, e.g. 'eip155:97'
  payload: {
    signature: Hex;
    authorization: Eip3009Authorization;
  };
}

export const BSC_TESTNET_CHAIN_ID = 97;
export const BSC_CAIP2: `eip155:${number}` = `eip155:${BSC_TESTNET_CHAIN_ID}`;

export const MOCK_USDC_ABI = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'authorizationState',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const;

/** EIP-712 typed-data for TransferWithAuthorization matching MockUSDC / Circle USDC. */
export function buildEip712TransferWithAuthorization(
  verifyingContract: Address,
  auth: Eip3009Authorization,
) {
  return {
    domain: {
      name: 'USDC',
      version: '1',
      chainId: BSC_TESTNET_CHAIN_ID,
      verifyingContract,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization' as const,
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  };
}

// ---------------------------------------------------------------------------
// Lazy client singletons
// ---------------------------------------------------------------------------

let _public: PublicClient | null = null;
let _wallet: WalletClient | null = null;

function resolveFacilitatorKey(): Hex | null {
  if (process.env.EVM_FACILITATOR_PRIVATE_KEY) {
    return process.env.EVM_FACILITATOR_PRIVATE_KEY as Hex;
  }
  // Dev fallback — same .keys file used by hardhat deploy.
  const keyPath = path.resolve(process.cwd(), '../../.keys/bsc-deployer.json');
  if (fs.existsSync(keyPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(keyPath, 'utf-8')) as { privateKey?: string };
      if (parsed.privateKey) return parsed.privateKey as Hex;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function getBscPublicClient(): PublicClient {
  if (_public) return _public;
  _public = createPublicClient({
    chain: bscTestnet,
    transport: http(process.env.BSC_RPC_URL ?? bscTestnet.rpcUrls.default.http[0]),
  });
  return _public;
}

export function getBscWalletClient(): WalletClient {
  if (_wallet) return _wallet;
  const pk = resolveFacilitatorKey();
  if (!pk) {
    throw new Error(
      'EVM_FACILITATOR_PRIVATE_KEY is not configured and .keys/bsc-deployer.json is missing.',
    );
  }
  _wallet = createWalletClient({
    account: privateKeyToAccount(pk),
    chain: bscTestnet,
    transport: http(process.env.BSC_RPC_URL ?? bscTestnet.rpcUrls.default.http[0]),
  });
  return _wallet;
}

export function getMockUsdcAddress(): Address {
  const addr = process.env.BSC_MOCKUSDC_ADDRESS;
  if (!addr) throw new Error('BSC_MOCKUSDC_ADDRESS is not set in .env');
  return addr as Address;
}

export function getResourceWallet(): Address {
  const addr = process.env.X402_EVM_RESOURCE_WALLET;
  if (!addr) throw new Error('X402_EVM_RESOURCE_WALLET is not set in .env');
  return addr as Address;
}

// ---------------------------------------------------------------------------
// Verification + settlement
// ---------------------------------------------------------------------------

export interface VerifyResult {
  ok: true;
  reason?: never;
}
export interface VerifyFail {
  ok: false;
  reason: string;
}

/**
 * Verify an EIP-3009 authorization signature and business rules before
 * settlement. Returns {ok:true} if the authorization is signature-valid and
 * covers at least `minValue` to `expectedPayee`, not yet used, within its
 * time window, and the signer has a sufficient MockUSDC balance.
 */
export async function verifyEvmPayment(
  payment: X402EvmPayment,
  expectedPayee: Address,
  minValue: bigint,
): Promise<VerifyResult | VerifyFail> {
  const auth = payment.payload.authorization;
  const sig = payment.payload.signature;

  if (payment.network !== BSC_CAIP2) {
    return { ok: false, reason: `Unsupported network ${payment.network}` };
  }
  if (auth.to.toLowerCase() !== expectedPayee.toLowerCase()) {
    return { ok: false, reason: 'Authorization not payable to resource wallet' };
  }
  if (BigInt(auth.value) < minValue) {
    return { ok: false, reason: 'Authorization value below required price' };
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now <= BigInt(auth.validAfter)) {
    return { ok: false, reason: 'Authorization not yet valid' };
  }
  if (now >= BigInt(auth.validBefore)) {
    return { ok: false, reason: 'Authorization expired' };
  }

  const usdc = getMockUsdcAddress();
  const typed = buildEip712TransferWithAuthorization(usdc, auth);

  const sigOk = await verifyTypedData({
    address: auth.from,
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
    signature: sig,
  });
  if (!sigOk) return { ok: false, reason: 'Invalid EIP-712 signature' };

  const pub = getBscPublicClient();
  const used = await pub.readContract({
    address: usdc,
    abi: MOCK_USDC_ABI,
    functionName: 'authorizationState',
    args: [auth.from, auth.nonce],
  });
  if (used) return { ok: false, reason: 'Authorization nonce already used' };

  const bal = await pub.readContract({
    address: usdc,
    abi: MOCK_USDC_ABI,
    functionName: 'balanceOf',
    args: [auth.from],
  });
  if (bal < BigInt(auth.value)) {
    return { ok: false, reason: 'Payer has insufficient USDC balance' };
  }

  return { ok: true };
}

/**
 * Relay `transferWithAuthorization` on-chain using the facilitator wallet
 * and wait for confirmation. Returns the tx hash. Throws on revert.
 */
export async function settleEvmPayment(payment: X402EvmPayment): Promise<Hex> {
  const auth = payment.payload.authorization;
  const sig = payment.payload.signature;
  // viem helper to split a compact signature into (v,r,s)
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  const v = parseInt(sig.slice(130, 132), 16);

  const wallet = getBscWalletClient();
  const pub = getBscPublicClient();
  const usdc = getMockUsdcAddress();
  const contract = getContract({
    address: usdc,
    abi: MOCK_USDC_ABI,
    client: { public: pub, wallet },
  });

  // writeContract requires non-undefined account on the wallet client
  if (!wallet.account) {
    throw new Error('Facilitator wallet has no account configured');
  }
  const hash = await contract.write.transferWithAuthorization(
    [
      auth.from,
      auth.to,
      BigInt(auth.value),
      BigInt(auth.validAfter),
      BigInt(auth.validBefore),
      auth.nonce,
      v,
      r,
      s,
    ],
    { account: wallet.account, chain: bscTestnet },
  );
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

/** Parse base64-encoded `X-Payment` header. */
export function parseX402PaymentHeader(header: string): X402EvmPayment | null {
  try {
    const json = Buffer.from(header, 'base64').toString('utf-8');
    const parsed = JSON.parse(json) as X402EvmPayment;
    if (
      !parsed ||
      parsed.x402Version !== 1 ||
      parsed.scheme !== 'exact' ||
      !parsed.payload?.authorization ||
      !parsed.payload.signature
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
