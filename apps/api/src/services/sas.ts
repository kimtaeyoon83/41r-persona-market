/**
 * Solana Attestation Service (SAS) wrapper
 *
 * Issues on-chain attestations for tester performance and persona credentials.
 * Requires SAS_CREDENTIAL_PDA and SAS_SCHEMA_PDA env vars (from scripts/setup-sas.ts).
 * Falls back to local mock attestation if SDK or env vars are unavailable.
 */

import fs from 'fs';

// SAS schema fields for 41R tester performance
export interface SASPerformanceData {
  tests_completed: number;
  avg_quality: number;
  expertise_defi: number;
  expertise_ai_tools: number;
  trust_tier: string; // "Bronze" | "Silver" | "Gold"
  persona_activated: boolean;
}

// Trust tier thresholds
export function calculateTrustTier(avgQuality: number, testsCompleted: number): string {
  if (avgQuality >= 4.0 && testsCompleted >= 10) return 'Gold';
  if (avgQuality >= 3.5 && testsCompleted >= 5) return 'Silver';
  return 'Bronze';
}

class SASService {
  private useFallback = true;
  private initialized = false;

  // Lazily loaded SDK references (typed as any to avoid @solana/kit cluster type issues)
  private kit: any = null;
  private sasLib: any = null;
  private payer: any = null;
  private rpc: any = null;
  private rpcSubs: any = null;
  private credentialPda: string | null = null;
  private schemaPda: string | null = null;

  /**
   * Lazy initialization — tries to set up real SAS SDK on first call.
   */
  private async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Check env vars
    this.credentialPda = process.env.SAS_CREDENTIAL_PDA || null;
    this.schemaPda = process.env.SAS_SCHEMA_PDA || null;

    if (!this.credentialPda || !this.schemaPda) {
      console.warn('[SAS] SAS_CREDENTIAL_PDA or SAS_SCHEMA_PDA not set — using fallback');
      console.warn('[SAS] Run `pnpm tsx scripts/setup-sas.ts` to create on-chain schema');
      return;
    }

    try {
      this.kit = await import('@solana/kit');
      this.sasLib = await import('sas-lib');

      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
      const wssUrl = process.env.SOLANA_WSS_URL || 'wss://api.devnet.solana.com';

      this.rpc = this.kit.createSolanaRpc(rpcUrl);
      this.rpcSubs = this.kit.createSolanaRpcSubscriptions(wssUrl);

      // Load keypair
      const keypairPath = (process.env.SOLANA_KEYPAIR_PATH || '~/.config/solana/id.json')
        .replace('~', process.env.HOME || '');

      const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8')) as number[];
      this.payer = await this.kit.createKeyPairSignerFromBytes(Uint8Array.from(secretKey));

      this.useFallback = false;
      console.log(`[SAS] Initialized — credential=${this.credentialPda.slice(0, 8)}… schema=${this.schemaPda.slice(0, 8)}…`);
    } catch (err) {
      console.warn('[SAS] SDK init failed, using fallback:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Issue a performance attestation for a tester
   */
  async issueAttestation(
    testerWallet: string,
    data: SASPerformanceData,
  ): Promise<{ attestationId: string; onChain: boolean; explorerUrl?: string }> {
    await this.init();

    if (this.useFallback) {
      return this.issueFallbackAttestation(testerWallet, data);
    }

    try {
      const {
        deriveAttestationPda, getCreateAttestationInstruction,
        serializeAttestationData, fetchSchema,
      } = this.sasLib;
      const {
        pipe, createTransactionMessage, setTransactionMessageLifetimeUsingBlockhash,
        setTransactionMessageFeePayerSigner, appendTransactionMessageInstructions,
        signTransactionMessageWithSigners, getSignatureFromTransaction,
        sendAndConfirmTransactionFactory, generateKeyPairSigner,
      } = this.kit;

      // Use a generated keypair as nonce (unique per attestation)
      const nonce = await generateKeyPairSigner();

      // Derive attestation PDA
      const [attestationPda] = await deriveAttestationPda({
        credential: this.credentialPda,
        schema: this.schemaPda,
        nonce: nonce.address,
      });

      // Fetch schema to serialize data
      const schema = await fetchSchema(this.rpc, this.schemaPda);

      // Serialize attestation data (u32 fields need integer values)
      const serializedData = serializeAttestationData(schema.data, {
        tests_completed: data.tests_completed,
        avg_quality_x100: Math.round(data.avg_quality * 100),
        expertise_defi_x100: Math.round(data.expertise_defi * 100),
        expertise_ai_x100: Math.round(data.expertise_ai_tools * 100),
        trust_tier: data.trust_tier,
        persona_activated: data.persona_activated ? 1 : 0,
      });

      // Expiry: 1 year from now
      const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

      const attestIx = getCreateAttestationInstruction({
        payer: this.payer,
        authority: this.payer,
        credential: this.credentialPda,
        schema: this.schemaPda,
        attestation: attestationPda,
        nonce: nonce.address,
        data: serializedData,
        expiry,
      });

      // Build + sign + send
      const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

      const tx = pipe(
        createTransactionMessage({ version: 0 }),
        (msg: any) => setTransactionMessageFeePayerSigner(this.payer, msg),
        (msg: any) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
        (msg: any) => appendTransactionMessageInstructions([attestIx], msg),
      );

      const signed = await signTransactionMessageWithSigners(tx);
      const signature = getSignatureFromTransaction(signed);

      await sendAndConfirmTransactionFactory({ rpc: this.rpc, rpcSubscriptions: this.rpcSubs })(
        signed,
        { commitment: 'confirmed' },
      );

      console.log(`[SAS] On-chain attestation: ${attestationPda} (tx: ${signature})`);

      return {
        attestationId: attestationPda as string,
        onChain: true,
        explorerUrl: `https://explorer.solana.com/address/${attestationPda}?cluster=devnet`,
      };
    } catch (err) {
      console.warn('[SAS] On-chain attestation failed, using fallback:', err instanceof Error ? err.message : err);
      return this.issueFallbackAttestation(testerWallet, data);
    }
  }

  /**
   * Update an existing attestation
   */
  async updateAttestation(
    attestationId: string,
    data: Partial<SASPerformanceData>,
  ): Promise<{ success: boolean; attestationId: string }> {
    if (this.useFallback || attestationId.startsWith('sas_demo_') || attestationId.startsWith('fallback_')) {
      console.log(`[SAS] Fallback update for ${attestationId}:`, data);
      return { success: true, attestationId };
    }

    // SAS attestations are immutable — would need close + recreate
    console.log(`[SAS] Update requested for ${attestationId} (no-op, SAS attestations are immutable)`);
    return { success: true, attestationId };
  }

  /**
   * Fallback: record attestation locally with demo ID
   */
  private issueFallbackAttestation(
    testerWallet: string,
    data: SASPerformanceData,
  ): { attestationId: string; onChain: boolean } {
    const attestId = `sas_demo_${data.trust_tier.toLowerCase()}_${testerWallet.slice(0, 8)}`;
    console.log(`[SAS] Fallback attestation: ${attestId}`, {
      tester: testerWallet,
      ...data,
    });
    return {
      attestationId: attestId,
      onChain: false,
    };
  }
}

export const sasService = new SASService();
