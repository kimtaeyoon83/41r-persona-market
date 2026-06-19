// PTB builders for the rpm Move package (packages/sui-move).
//
// Pure functions: each returns a configured `Transaction` targeting the
// published package's entry/public functions. No network, no signing —
// the caller signs+executes with getSuiSigner()/getSuiClient(). This is
// the off-chain mirror of the on-chain modules (persona / campaign /
// mutual); the test suite asserts each builder targets the right module
// + function so drift between Move and TS is caught without a devnet.

import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';

// ─── persona.move ────────────────────────────────────────────────────

export function buildMintPersona(packageId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::persona::mint_to_sender`,
    arguments: [tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}

export function buildAddMemwalRef(
  packageId: string,
  personaId: string,
  blobId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::persona::add_memwal_ref`,
    arguments: [tx.object(personaId), tx.pure.string(blobId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}

export function buildSetAdapterRef(
  packageId: string,
  personaId: string,
  blobId: string,
  baseModelVersion: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::persona::set_adapter_ref`,
    arguments: [
      tx.object(personaId),
      tx.pure.string(blobId),
      tx.pure.string(baseModelVersion),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export function buildTransferPersona(
  packageId: string,
  personaId: string,
  recipient: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::persona::transfer_to`,
    arguments: [tx.object(personaId), tx.pure.address(recipient)],
  });
  return tx;
}

export function buildBurnPersona(packageId: string, personaId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::persona::burn`,
    arguments: [tx.object(personaId)],
  });
  return tx;
}

// ─── campaign.move ───────────────────────────────────────────────────

/** Create a campaign locking `rewardCoinId` as escrow; cap goes to sender. */
export function buildCreateCampaign(
  packageId: string,
  rewardCoinId: string,
  target: string,
  personaCriteria: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::campaign::create_and_keep`,
    arguments: [
      tx.object(rewardCoinId),
      tx.pure.string(target),
      tx.pure.string(personaCriteria),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export function buildSettleCampaign(
  packageId: string,
  campaignId: string,
  capId: string,
  recipient: string,
  amount: bigint,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::campaign::settle`,
    arguments: [
      tx.object(campaignId),
      tx.object(capId),
      tx.pure.address(recipient),
      tx.pure.u64(amount),
    ],
  });
  return tx;
}

export function buildCloseCampaign(
  packageId: string,
  campaignId: string,
  capId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::campaign::close`,
    arguments: [tx.object(campaignId), tx.object(capId)],
  });
  return tx;
}

// ─── mutual.move ─────────────────────────────────────────────────────

/** Company creates a mutual-sealed campaign; the returned cap is sent to
 *  `capOwner` (the requester). */
export function buildCreateMutual(
  packageId: string,
  rewardCoinId: string,
  assetBlobRef: string,
  assetHash: string,
  assetSealPolicy: string,
  sandboxOnly: boolean,
  capOwner: string,
): Transaction {
  const tx = new Transaction();
  const cap = tx.moveCall({
    target: `${packageId}::mutual::create`,
    arguments: [
      tx.object(rewardCoinId),
      tx.pure.string(assetBlobRef),
      tx.pure.string(assetHash),
      tx.pure.string(assetSealPolicy),
      tx.pure.bool(sandboxOnly),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  tx.transferObjects([cap], tx.pure.address(capOwner));
  return tx;
}

export function buildOptInMutual(
  packageId: string,
  mutualId: string,
  stakeCoinId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::mutual::opt_in`,
    arguments: [tx.object(mutualId), tx.object(stakeCoinId)],
  });
  return tx;
}

export function buildMarkAssetRevealed(packageId: string, mutualId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::mutual::mark_asset_revealed`,
    arguments: [tx.object(mutualId)],
  });
  return tx;
}

export function buildCommitEvidence(
  packageId: string,
  mutualId: string,
  evidenceBlobRef: string,
  evidenceSealPolicy: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::mutual::commit_evidence`,
    arguments: [
      tx.object(mutualId),
      tx.pure.string(evidenceBlobRef),
      tx.pure.string(evidenceSealPolicy),
    ],
  });
  return tx;
}

export function buildRevealEvidence(
  packageId: string,
  mutualId: string,
  capId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::mutual::reveal_evidence`,
    arguments: [tx.object(mutualId), tx.object(capId)],
  });
  return tx;
}

export function buildSettleMutual(
  packageId: string,
  mutualId: string,
  capId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::mutual::settle`,
    arguments: [tx.object(mutualId), tx.object(capId)],
  });
  return tx;
}

export function buildSlashMutual(
  packageId: string,
  mutualId: string,
  capId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::mutual::slash`,
    arguments: [tx.object(mutualId), tx.object(capId)],
  });
  return tx;
}
