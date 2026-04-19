"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWalletContext } from "@/components/wallet-provider";
import { testApi } from "@/lib/api";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

// USDC on devnet
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const PLATFORM_WALLET = new PublicKey("8Vm3ys3kwLSy2qThejn56E2j6fptwSE2qcLkEeiLrdB8");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

// Derive Associated Token Account (ATA) address
function getATA(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

// SPL Token Transfer instruction (instruction index = 3)
function createTokenTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0); // Transfer instruction
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

type SubmitStep = "idle" | "depositing" | "confirming" | "creating" | "done";

const LLM_PROGRESS_STEPS = [
  "Analyzing target URL...",
  "Generating checklist...",
  "Creating scenarios...",
  "Building questionnaire...",
  "Finalizing test cases...",
];

function AiLoadingIndicator({ step }: { step: SubmitStep }) {
  const [progressIndex, setProgressIndex] = useState(0);

  useEffect(() => {
    if (step !== "creating") {
      setProgressIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setProgressIndex((prev) =>
        prev < LLM_PROGRESS_STEPS.length - 1 ? prev + 1 : prev,
      );
    }, 3500);

    return () => clearInterval(interval);
  }, [step]);

  if (step !== "creating") return null;

  return (
    <div className="p-4 bg-[var(--surface-card)] border border-sol-purple/20 rounded-lg space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative h-5 w-5">
          <div className="absolute inset-0 rounded-full border-2 border-sol-purple/30" />
          <div className="absolute inset-0 rounded-full border-2 border-sol-purple border-t-transparent animate-spin" />
        </div>
        <span className="text-sm font-medium text-sol-purple">
          Generating AI test cases...
        </span>
      </div>

      <div className="space-y-2 pl-8">
        {LLM_PROGRESS_STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 text-xs">
            {i < progressIndex ? (
              <svg className="h-3.5 w-3.5 text-[var(--status-success,#22c55e)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : i === progressIndex ? (
              <div className="h-3.5 w-3.5 flex items-center justify-center">
                <div className="h-1.5 w-1.5 rounded-full bg-sol-purple animate-pulse" />
              </div>
            ) : (
              <div className="h-3.5 w-3.5 flex items-center justify-center">
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]/40" />
              </div>
            )}
            <span
              className={
                i < progressIndex
                  ? "text-[var(--text-secondary)] line-through"
                  : i === progressIndex
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-tertiary)]"
              }
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-[var(--text-tertiary)] pl-8">
        This may take 10-20 seconds...
      </p>
    </div>
  );
}

export default function RegisterTest() {
  const router = useRouter();
  const { publicKey, signMessage } = useWalletContext();
  const [step, setStep] = useState<SubmitStep>("idle");
  const [error, setError] = useState("");
  const [txSignature, setTxSignature] = useState("");

  // Auto-fill wallet from connected wallet
  useEffect(() => {
    if (publicKey) {
      setForm((prev) => ({ ...prev, company_wallet: publicKey }));
    }
  }, [publicKey]);

  const [form, setForm] = useState({
    target_url: "",
    requirements: "",
    budget_usdc: 50,
    reward_per_tester: 3,
    company_wallet: "",
    enable_auto_test: true,
  });

  const maxTesters = form.reward_per_tester > 0
    ? Math.floor(form.budget_usdc / form.reward_per_tester)
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setTxSignature("");

    // --- Step 1: Validate & check Phantom ---
    const phantom = (
      window as unknown as {
        phantom?: {
          solana?: {
            isPhantom?: boolean;
            signTransaction: (tx: Transaction) => Promise<Transaction>;
            publicKey?: { toBase58: () => string } | null;
          };
        };
      }
    ).phantom;

    if (!phantom?.solana?.isPhantom) {
      setError("Phantom wallet not found. Please install Phantom.");
      return;
    }

    // --- Step 2: Deposit USDC via Phantom ---
    setStep("depositing");
    let signature: string;
    try {
      const connection = new Connection(SOLANA_RPC, "confirmed");
      const senderPubkey = new PublicKey(form.company_wallet);

      // Derive ATAs
      const senderATA = getATA(senderPubkey, USDC_MINT);
      const platformATA = getATA(PLATFORM_WALLET, USDC_MINT);

      // USDC has 6 decimals
      const amountLamports = BigInt(Math.round(form.budget_usdc * 1_000_000));

      const transferIx = createTokenTransferInstruction(
        senderATA,
        platformATA,
        senderPubkey,
        amountLamports,
      );

      const transaction = new Transaction().add(transferIx);
      transaction.feePayer = senderPubkey;

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;

      // Sign with Phantom, then send via our devnet connection
      const signed = await phantom.solana.signTransaction(transaction);
      signature = await connection.sendRawTransaction(signed.serialize());

      // --- Step 3: Confirm the transaction on-chain ---
      setStep("confirming");
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );

      setTxSignature(signature);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "USDC deposit failed";

      if (
        message.includes("User rejected") ||
        message.includes("cancelled")
      ) {
        setError("Payment cancelled. No test was registered.");
      } else {
        setError(`Payment failed: ${message}`);
      }
      setStep("idle");
      return;
    }

    // --- Step 4: Register the test via API (includes LLM generation) ---
    setStep("creating");
    try {
      const result = (await testApi.register({
        target_url: form.target_url,
        requirements: form.requirements,
        budget_usdc: form.budget_usdc,
        reward_per_tester: form.reward_per_tester,
        company_wallet: form.company_wallet,
        deposit_tx_signature: signature,
        enable_auto_test: form.enable_auto_test,
      }, signMessage)) as { test: { id: string } };

      setStep("done");

      // Redirect after brief pause to show success
      setTimeout(() => {
        router.push(`/company/test/${result.test.id}`);
      }, 2000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to register test. Payment was received -- please contact support.",
      );
      setStep("idle");
    }
  };

  const loading = step !== "idle" && step !== "done";

  const stepLabel: Record<SubmitStep, string> = {
    idle: "Deposit USDC & Register Test",
    depositing: "Approve USDC deposit in Phantom...",
    confirming: "Confirming transaction on Solana...",
    creating: "Generating AI test cases...",
    done: "Done! Redirecting...",
  };

  return (
    <div className="max-w-2xl">
      <h1 className="t-display-m mb-1">Register New Test</h1>
      <p className="t-caption mb-7">URL + budget → AI-drafted test cases in ~15s</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">
            Company Wallet Address
          </label>
          <input
            type="text"
            value={form.company_wallet}
            onChange={(e) =>
              setForm({ ...form, company_wallet: e.target.value })
            }
            placeholder="Enter your Solana wallet address"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">
            Target URL
          </label>
          <input
            type="url"
            value={form.target_url}
            onChange={(e) => setForm({ ...form, target_url: e.target.value })}
            placeholder="https://your-app.com"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">
            Test Requirements
          </label>
          <textarea
            value={form.requirements}
            onChange={(e) =>
              setForm({ ...form, requirements: e.target.value })
            }
            placeholder="Describe what you want tested (e.g., 'Test the swap functionality, check wallet connection, verify error handling')"
            rows={4}
            className="resize-none"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">
            Budget (USDC)
          </label>
          <input
            type="number"
            value={form.budget_usdc}
            onChange={(e) =>
              setForm({ ...form, budget_usdc: Number(e.target.value) })
            }
            min={1}
            max={1000}
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">
            Reward per Tester (USDC)
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              value={form.reward_per_tester}
              onChange={(e) =>
                setForm({ ...form, reward_per_tester: Number(e.target.value) })
              }
              min={0.1}
              max={10}
              step={0.1}
              className="flex-1 accent-sol-purple"
            />
            <span className="text-sm font-mono w-14 text-center tabular-nums">
              ${form.reward_per_tester.toFixed(1)}
            </span>
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
            Max testers = budget / reward = {maxTesters}
          </p>
        </div>

        {/* Enable Auto-Test Toggle */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="enable_auto_test"
            checked={form.enable_auto_test}
            onChange={(e) =>
              setForm({ ...form, enable_auto_test: e.target.checked })
            }
            className="mt-1 h-4 w-4 rounded border-[var(--border)] accent-sol-purple cursor-pointer"
          />
          <label htmlFor="enable_auto_test" className="cursor-pointer">
            <span className="block text-sm font-medium text-[var(--text-primary)]">
              Enable AI Auto-Test
            </span>
            <span className="block text-xs text-[var(--text-tertiary)] mt-0.5">
              Automatically match and run tests with AI Personas
            </span>
          </label>
        </div>

        {error && (
          <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-lg text-[var(--status-error)] text-sm">
            {error}
          </div>
        )}

        {txSignature && (
          <div className="p-3 bg-[var(--status-success,#22c55e)]/10 border border-[var(--status-success,#22c55e)]/20 rounded-lg text-sm">
            <p className="font-medium text-[var(--status-success,#22c55e)]">
              Deposit confirmed!
            </p>
            <p className="text-[var(--text-tertiary)] mt-1 break-all font-mono text-xs">
              TX: {txSignature}
            </p>
          </div>
        )}

        <AiLoadingIndicator step={step} />

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-sol-purple hover:bg-sol-purple/80 disabled:bg-surface-card disabled:text-[var(--text-tertiary)] rounded-lg font-medium transition-colors"
        >
          {stepLabel[step]}
        </button>
      </form>
    </div>
  );
}
