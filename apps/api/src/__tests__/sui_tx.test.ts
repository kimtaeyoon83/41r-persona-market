import { describe, expect, it } from 'vitest';
import type { Transaction } from '@mysten/sui/transactions';
import {
  buildAddMemwalRef,
  buildBurnPersona,
  buildCloseCampaign,
  buildCommitEvidence,
  buildCreateCampaign,
  buildCreateMutual,
  buildCreateMutualFromGas,
  buildMarkAssetRevealed,
  buildMintPersona,
  buildOptInMutual,
  buildRevealEvidence,
  buildSetAdapterRef,
  buildSettleCampaign,
  buildSettleMutual,
  buildSlashMutual,
  buildTransferPersona,
} from '../services/sui/tx.js';

const PKG = '0x2';
const OBJ = '0x123';
const CAP = '0x456';
const ADDR = '0x789';

// Extract (module, function, arg-count) for every MoveCall in a tx, in
// order — the off-chain↔on-chain contract we assert.
function moveCalls(
  tx: Transaction,
): Array<{ module: string; fn: string; args: number }> {
  const out: Array<{ module: string; fn: string; args: number }> = [];
  for (const cmd of tx.getData().commands) {
    if (cmd.$kind === 'MoveCall' && cmd.MoveCall) {
      out.push({
        module: cmd.MoveCall.module,
        fn: cmd.MoveCall.function,
        args: cmd.MoveCall.arguments.length,
      });
    }
  }
  return out;
}

describe('persona PTB builders', () => {
  it('mint → persona::mint_to_sender(clock)', () => {
    expect(moveCalls(buildMintPersona(PKG))).toEqual([
      { module: 'persona', fn: 'mint_to_sender', args: 1 },
    ]);
  });

  it('add_memwal_ref takes persona + blob + clock', () => {
    expect(moveCalls(buildAddMemwalRef(PKG, OBJ, 'blob'))).toEqual([
      { module: 'persona', fn: 'add_memwal_ref', args: 3 },
    ]);
  });

  it('set_adapter_ref takes persona + blob + base + clock', () => {
    expect(moveCalls(buildSetAdapterRef(PKG, OBJ, 'blob', 'base-v1'))).toEqual([
      { module: 'persona', fn: 'set_adapter_ref', args: 4 },
    ]);
  });

  it('transfer + burn', () => {
    expect(moveCalls(buildTransferPersona(PKG, OBJ, ADDR))).toEqual([
      { module: 'persona', fn: 'transfer_to', args: 2 },
    ]);
    expect(moveCalls(buildBurnPersona(PKG, OBJ))).toEqual([
      { module: 'persona', fn: 'burn', args: 1 },
    ]);
  });
});

describe('campaign PTB builders', () => {
  it('create / settle / close', () => {
    const SUI_T = '0x2::sui::SUI';
    expect(moveCalls(buildCreateCampaign(PKG, SUI_T, OBJ, 'https://x', '{}'))).toEqual([
      { module: 'campaign', fn: 'create_and_keep', args: 4 },
    ]);
    expect(moveCalls(buildSettleCampaign(PKG, SUI_T, OBJ, CAP, ADDR, 600n))).toEqual([
      { module: 'campaign', fn: 'settle', args: 4 },
    ]);
    expect(moveCalls(buildCloseCampaign(PKG, SUI_T, OBJ, CAP))).toEqual([
      { module: 'campaign', fn: 'close', args: 2 },
    ]);
  });
});

describe('mutual PTB builders', () => {
  it('create returns a cap that is transferred to the owner', () => {
    const tx = buildCreateMutual(PKG, OBJ, 'a', 'h', 'pol', true, ADDR);
    // One MoveCall (create) + a transferObjects command for the cap.
    expect(moveCalls(tx)).toEqual([{ module: 'mutual', fn: 'create', args: 6 }]);
    const kinds = tx.getData().commands.map((c) => c.$kind);
    expect(kinds).toContain('TransferObjects');
  });

  it('createFromGas splits the reward from gas, creates, transfers the cap', () => {
    const tx = buildCreateMutualFromGas(PKG, 1_000n, 'blob', 'hash', 'pol', true, ADDR);
    expect(moveCalls(tx)).toEqual([{ module: 'mutual', fn: 'create', args: 6 }]);
    const kinds = tx.getData().commands.map((c) => c.$kind);
    expect(kinds).toContain('SplitCoins'); // reward funded from the gas coin
    expect(kinds).toContain('TransferObjects'); // cap → owner
  });

  it('the full exchange state machine maps 1:1 to builders', () => {
    expect(moveCalls(buildOptInMutual(PKG, OBJ, CAP))).toEqual([
      { module: 'mutual', fn: 'opt_in', args: 2 },
    ]);
    expect(moveCalls(buildMarkAssetRevealed(PKG, OBJ))).toEqual([
      { module: 'mutual', fn: 'mark_asset_revealed', args: 1 },
    ]);
    expect(moveCalls(buildCommitEvidence(PKG, OBJ, 'ev', 'pol'))).toEqual([
      { module: 'mutual', fn: 'commit_evidence', args: 3 },
    ]);
    expect(moveCalls(buildRevealEvidence(PKG, OBJ, CAP))).toEqual([
      { module: 'mutual', fn: 'reveal_evidence', args: 2 },
    ]);
    expect(moveCalls(buildSettleMutual(PKG, OBJ, CAP))).toEqual([
      { module: 'mutual', fn: 'settle', args: 2 },
    ]);
    expect(moveCalls(buildSlashMutual(PKG, OBJ, CAP))).toEqual([
      { module: 'mutual', fn: 'slash', args: 2 },
    ]);
  });
});
