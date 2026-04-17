# BSC Autotest — x402 on Binance Smart Chain Testnet

Parallel autotest flow to the existing Solana path, using the x402 Exact EVM scheme (EIP-3009) on BSC testnet (chainId 97). Solana path is untouched.

## Why a MockUSDC?

Circle does not operate a faucet for BSC testnet, and the community `0x64544969...` USDC on BSC testnet lacks EIP-3009 support, so the x402 protocol cannot authorize payments against it. We ship a minimal `MockUSDC` (`packages/contracts/contracts/MockUSDC.sol`) that:

- Matches mainnet USDC semantics (6 decimals, `name="USDC"`, EIP-712 domain version 1)
- Implements `transferWithAuthorization` / `receiveWithAuthorization` / `cancelAuthorization`
- Exposes a public `mint(to, amount)` capped at 1000 USDC per call

## One-time deploy

1. Create an EVM wallet and fund it with tBNB from the BNB Chain faucet: https://www.bnbchain.org/en/testnet-faucet
2. Copy the private key (hex, 0x-prefixed) into root `.env`:
   ```
   DEPLOYER_PRIVATE_KEY=0x...
   BSCSCAN_API_KEY=            # optional, for verify
   ```
3. Install + deploy:
   ```bash
   pnpm --filter @41rpm/contracts install
   pnpm --filter @41rpm/contracts test          # 6 tests, local-only
   pnpm --filter @41rpm/contracts deploy:bsc-testnet
   ```
4. The script prints the deployed address. Copy it into root `.env`:
   ```
   BSC_MOCKUSDC_ADDRESS=0x...
   NEXT_PUBLIC_BSC_MOCKUSDC_ADDRESS=0x...
   ```

## Facilitator wallet (server)

The API server executes `transferWithAuthorization` on behalf of the payer, so it pays tBNB gas. Fund a separate wallet and set:

```
X402_EVM_RESOURCE_WALLET=0x...       # where USDC lands (operator wallet)
EVM_FACILITATOR_PRIVATE_KEY=0x...    # signs the transferWithAuthorization tx
```

Both wallets can be the same for demo simplicity.

## User flow (frontend)

1. User visits `/autotest-bsc`, clicks "Connect Wallet" — MetaMask prompts to add BSC testnet if missing.
2. If balance is 0, user clicks "Claim 100 USDC" → calls `MockUSDC.mint()` directly. Requires tBNB for gas.
3. User picks test + persona, clicks "Pay $0.10 & Run". MetaMask opens a typed-data (EIP-712) prompt — no gas, just a signature.
4. Frontend `POST /api/autotest-bsc/run` with `X-Payment: <base64(eip3009-auth)>` header.
5. API verifies the signature, relays `transferWithAuthorization` on-chain (settles gas), then kicks off the autotest job. Same status polling as Solana.

## Deployed addresses

| Network | Contract | Address |
|---|---|---|
| BSC Testnet (97) | MockUSDC | [`0x8421CaFba78BC901F05083587B79663B3036cAEa`](https://testnet.bscscan.com/address/0x8421CaFba78BC901F05083587B79663B3036cAEa) |
| BSC Testnet (97) | Facilitator / Resource wallet | `0x9733aF65DF244bb24e9447bC9bfd14A602d8769d` |

## Troubleshooting

- **`Error: insufficient funds for gas`** during `mint` — get tBNB from https://www.bnbchain.org/en/testnet-faucet
- **`AuthorizationExpired`** — the EIP-712 authorization has a 1 hour window; resign.
- **`AuthorizationAlreadyUsed`** — nonce collision; frontend should generate a fresh 32-byte nonce per request.
