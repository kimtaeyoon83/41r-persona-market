"use client";

import { useEffect, useState, useCallback } from "react";
import { testApi, personaApi, autoTestApi } from "@/lib/api";
import { useWalletContext } from "@/components/wallet-provider";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

interface Test { id: string; targetUrl: string; status: string }
interface Persona {
  id: string;
  testerAddr: string;
  vector: {
    voice_sample: string;
    expertise: Record<string, number>;
    demographics?: { age_group: string };
  };
}

interface StepScreenshot {
  file: string;
  label: string;
  step: number;
  phase: "init" | "checklist" | "persona" | "final";
}

interface AutoTestResult {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress?: number;
  report_id?: string;
  error?: string;
  result?: {
    screenshots: string[];
    steps?: StepScreenshot[];
    actionLog: string[];
    textReport: string;
    uxFeedback: Record<string, unknown>;
    txSignature?: string;
  };
}

// USDC payment constants (same as company register)
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const PLATFORM_WALLET = new PublicKey("8Vm3ys3kwLSy2qThejn56E2j6fptwSE2qcLkEeiLrdB8");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
const AUTOTEST_PRICE_USDC = 0.10;

function getATA(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

function createTokenTransferInstruction(
  source: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
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

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  init: { bg: "bg-sol-blue/10", text: "text-sol-blue", border: "border-sol-blue/30", dot: "bg-sol-blue" },
  checklist: { bg: "bg-sol-purple/10", text: "text-sol-purple", border: "border-sol-purple/30", dot: "bg-sol-purple" },
  persona: { bg: "bg-sol-green/10", text: "text-sol-green", border: "border-sol-green/30", dot: "bg-sol-green" },
  final: { bg: "bg-sol-green/10", text: "text-sol-green", border: "border-sol-green/30", dot: "bg-sol-green" },
};

const PHASE_LABELS: Record<string, string> = {
  init: "Page Load",
  checklist: "Checklist",
  persona: "Persona Exploration",
  final: "Complete",
};

type PayStep = "idle" | "paying" | "confirming" | "running";

export default function AutoTestPage() {
  const { publicKey, connect } = useWalletContext();
  const [tests, setTests] = useState<Test[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedTest, setSelectedTest] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoTestResult | null>(null);
  const [polling, setPolling] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [payStep, setPayStep] = useState<PayStep>("idle");
  const [paymentTx, setPaymentTx] = useState<string>("");
  const [payError, setPayError] = useState("");

  useEffect(() => {
    Promise.all([
      testApi.list() as Promise<Test[]>,
      personaApi.list() as Promise<Persona[]>,
    ]).then(([t, p]) => {
      setTests(t.filter(x => x.status === "active"));
      setPersonas(p);
    });
  }, []);

  const pollStatus = useCallback(async (jobId: string) => {
    setPolling(true);
    const poll = async () => {
      try {
        const status = await autoTestApi.status(jobId) as AutoTestResult;
        setResult(status);
        if (status.status === "completed" || status.status === "failed") {
          setPolling(false);
          setRunning(false);
          return;
        }
        setTimeout(poll, 3000);
      } catch {
        setPolling(false);
        setRunning(false);
      }
    };
    poll();
  }, []);

  const handleRun = async () => {
    if (!selectedTest || !selectedPersona) return;

    // Ensure wallet is connected
    if (!publicKey) {
      await connect();
      return;
    }

    setPayError("");
    setPaymentTx("");
    setResult(null);
    setExpandedStep(null);

    // Step 1: USDC payment via Phantom
    setPayStep("paying");
    let txSignature: string;
    try {
      const phantom = (
        window as unknown as {
          phantom?: {
            solana?: {
              isPhantom?: boolean;
              signTransaction: (tx: Transaction) => Promise<Transaction>;
            };
          };
        }
      ).phantom;

      if (!phantom?.solana?.isPhantom) {
        throw new Error("Phantom wallet not found");
      }

      const connection = new Connection(SOLANA_RPC, "confirmed");
      const senderPubkey = new PublicKey(publicKey);
      const senderATA = getATA(senderPubkey, USDC_MINT);
      const platformATA = getATA(PLATFORM_WALLET, USDC_MINT);
      const amountLamports = BigInt(Math.round(AUTOTEST_PRICE_USDC * 1_000_000));

      const transferIx = createTokenTransferInstruction(senderATA, platformATA, senderPubkey, amountLamports);
      const transaction = new Transaction().add(transferIx);
      transaction.feePayer = senderPubkey;

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;

      // Sign with Phantom, then send via our devnet connection
      const signed = await phantom.solana.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      // Step 2: Confirm payment
      setPayStep("confirming");
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      txSignature = signature;
      setPaymentTx(signature);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Payment failed";
      if (msg.includes("User rejected") || msg.includes("cancelled")) {
        setPayError("Payment cancelled by user.");
      } else {
        setPayError(`Payment failed: ${msg}`);
      }
      setPayStep("idle");
      return;
    }

    // Step 3: Start auto test with payment proof
    setPayStep("running");
    setRunning(true);
    try {
      const res = await autoTestApi.run({
        test_id: selectedTest,
        persona_id: selectedPersona,
        payment_tx: txSignature,
      }) as AutoTestResult;
      setResult(res);
      if (res.job_id) {
        pollStatus(res.job_id);
      }
    } catch (err) {
      setResult({ job_id: "", status: "failed", error: err instanceof Error ? err.message : "Unknown error" });
      setRunning(false);
    }
    setPayStep("idle");
  };

  const selectedPersonaData = personas.find(p => p.id === selectedPersona);
  const topExpertise = selectedPersonaData
    ? Object.entries(selectedPersonaData.vector.expertise).sort(([, a], [, b]) => b - a).slice(0, 3)
    : [];

  const steps = result?.result?.steps || [];
  const hasSteps = steps.length > 0;

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-2xl font-bold mb-2">Auto Test Engine</h1>
      <p className="text-[var(--text-secondary)] text-sm mb-8">AI Persona-driven automated browser testing with Stagehand</p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">Select Test</label>
          <select
            value={selectedTest}
            onChange={(e) => setSelectedTest(e.target.value)}
          >
            <option value="">Choose a test...</option>
            {tests.map(t => (
              <option key={t.id} value={t.id}>{t.targetUrl} ({t.id.slice(0, 8)})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">Select Persona</label>
          <select
            value={selectedPersona}
            onChange={(e) => setSelectedPersona(e.target.value)}
          >
            <option value="">Choose a persona...</option>
            {personas.map(p => (
              <option key={p.id} value={p.id}>
                {p.id.slice(0, 8)} — {Object.entries(p.vector.expertise).sort(([, a], [, b]) => b - a)[0]?.[0] || "general"}
                {p.vector.demographics ? ` (${p.vector.demographics.age_group})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedPersonaData && (
        <div className="p-3 rounded-xl bg-surface border border-border-dim mb-4 text-sm">
          <div className="flex items-center gap-2 mb-1">
            {topExpertise.map(([k, v]) => (
              <span key={k} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-green/8 text-sol-green">
                {k}: {(v * 100).toFixed(0)}%
              </span>
            ))}
            {selectedPersonaData.vector.demographics && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-purple/8 text-sol-purple">
                {selectedPersonaData.vector.demographics.age_group}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-tertiary)] italic mt-1">&quot;{selectedPersonaData.vector.voice_sample.slice(0, 120)}...&quot;</p>
        </div>
      )}

      {/* x402 Payment Info */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border-dim mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sol-blue/10 flex items-center justify-center">
            <span className="text-sm font-bold text-sol-blue">$</span>
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">x402 Micropayment</p>
            <p className="text-xs text-[var(--text-tertiary)]">USDC on Solana devnet</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-display font-bold text-sol-blue">${AUTOTEST_PRICE_USDC.toFixed(2)}</p>
          <p className="text-[10px] text-[var(--text-tertiary)] font-mono">per execution</p>
        </div>
      </div>

      {payError && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-lg text-[var(--status-error)] text-sm mb-4">
          {payError}
        </div>
      )}

      {paymentTx && (
        <div className="p-3 bg-sol-green/5 border border-sol-green/20 rounded-lg text-sm mb-4">
          <p className="font-medium text-sol-green">Payment confirmed</p>
          <a
            href={`https://explorer.solana.com/tx/${paymentTx}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-[var(--text-tertiary)] hover:text-sol-blue transition-colors"
          >
            TX: {paymentTx.slice(0, 20)}...{paymentTx.slice(-8)}
          </a>
        </div>
      )}

      {publicKey && (
        <div className="mb-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-sol-green/5 border border-sol-green/15">
          <div className="w-2 h-2 rounded-full bg-sol-green" />
          <span className="text-xs text-[var(--text-secondary)]">Paying as</span>
          <span className="text-xs font-mono text-sol-green">{publicKey.slice(0, 4)}...{publicKey.slice(-4)}</span>
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={running || !selectedTest || !selectedPersona || (payStep !== "idle" && payStep !== "running")}
        className="w-full py-3 bg-sol-green hover:bg-sol-green/80 disabled:bg-surface-card disabled:text-[var(--text-tertiary)] rounded-lg font-medium transition-colors mb-8 text-surface-base"
      >
        {payStep === "paying" ? "Approve $0.10 USDC in Phantom..." :
         payStep === "confirming" ? "Confirming payment..." :
         running ? "Running Auto Test..." :
         publicKey ? `Pay $${AUTOTEST_PRICE_USDC.toFixed(2)} & Run Auto Test` :
         "Connect Wallet & Run"}
      </button>

      {result && (result.status === "queued" || result.status === "running") && (
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-sol-green font-mono">{result.status === "queued" ? "Queued..." : "Running..."}</span>
            <span className="text-[var(--text-tertiary)] font-mono">{result.progress || 0}%</span>
          </div>
          <div className="w-full h-2 bg-surface-card rounded-full overflow-hidden">
            <div
              className="h-full bg-sol-green rounded-full transition-all duration-500"
              style={{ width: `${result.progress || 0}%` }}
            />
          </div>
          {polling && <p className="text-xs text-[var(--text-tertiary)] mt-2 font-mono">Polling for updates every 3s...</p>}
        </div>
      )}

      {result?.status === "failed" && (
        <div className="p-4 rounded-xl border border-[var(--status-error)]/20 bg-[var(--status-error)]/5 mb-8">
          <h3 className="text-sm font-medium text-[var(--status-error)] mb-2">Test Failed</h3>
          <p className="text-sm text-[var(--text-secondary)]">{result.error}</p>
        </div>
      )}

      {result?.status === "completed" && result.result && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl border border-sol-green/20 bg-sol-green/5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-sol-green mb-1">Auto Test Complete</h3>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {steps.length} screenshots captured across {result.result.actionLog.length} actions
                </p>
              </div>
              {result.report_id && (
                <a href={`/report/${result.report_id}`} className="px-3 py-1.5 text-xs bg-sol-blue/10 text-sol-blue border border-sol-blue/20 rounded-lg hover:bg-sol-blue/15 transition-colors">
                  View Full Report
                </a>
              )}
            </div>
          </div>

          {hasSteps && (
            <div>
              <h3 className="font-display text-lg font-semibold mb-4">Browser Session Timeline</h3>

              <div className="flex gap-3 mb-4 text-xs">
                {Object.entries(PHASE_LABELS).map(([phase, label]) => {
                  const count = steps.filter(s => s.phase === phase).length;
                  if (count === 0) return null;
                  const colors = PHASE_COLORS[phase];
                  return (
                    <span key={phase} className={`px-2 py-1 rounded-md font-mono ${colors.bg} ${colors.text}`}>
                      {label}: {count}
                    </span>
                  );
                })}
              </div>

              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-border-dim" />

                <div className="space-y-3">
                  {steps.map((step, i) => {
                    const colors = PHASE_COLORS[step.phase] || PHASE_COLORS.init;
                    const isExpanded = expandedStep === i;

                    return (
                      <div key={i} className="relative pl-10">
                        <div className={`absolute left-[11px] top-3 w-[10px] h-[10px] rounded-full ${colors.dot} ring-2 ring-surface-base`} />

                        <div
                          className={`rounded-xl border ${colors.border} ${isExpanded ? colors.bg : "bg-surface/50"} cursor-pointer transition-all hover:bg-surface-elevated`}
                          onClick={() => setExpandedStep(isExpanded ? null : i)}
                        >
                          <div className="flex items-center gap-3 p-3">
                            <span className={`text-xs font-mono ${colors.text} w-6 text-center shrink-0`}>
                              {String(step.step).padStart(2, "0")}
                            </span>
                            <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded-md ${colors.bg} ${colors.text} shrink-0`}>
                              {PHASE_LABELS[step.phase]}
                            </span>
                            <p className="text-sm text-[var(--text-primary)] truncate flex-1">{step.label}</p>
                            <svg
                              className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>

                          {isExpanded && (
                            <div className="px-3 pb-3">
                              <div className="rounded-lg overflow-hidden border border-border-dim bg-surface-base">
                                <img
                                  src={`http://localhost:4100/screenshots/${step.file}`}
                                  alt={step.label}
                                  className="w-full"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).alt = "Screenshot not available";
                                    (e.target as HTMLImageElement).style.height = "60px";
                                    (e.target as HTMLImageElement).style.display = "flex";
                                  }}
                                />
                              </div>
                              <p className="text-[10px] text-[var(--text-tertiary)] mt-1 font-mono">{step.file}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6">
                <h4 className="text-sm text-[var(--text-secondary)] mb-3 font-mono">Filmstrip Overview</h4>
                <div className="flex gap-2 overflow-x-auto pb-3">
                  {steps.map((step, i) => {
                    const colors = PHASE_COLORS[step.phase] || PHASE_COLORS.init;
                    return (
                      <div
                        key={i}
                        className={`shrink-0 w-40 cursor-pointer rounded-lg border ${expandedStep === i ? colors.border + " " + colors.bg : "border-border-dim"} overflow-hidden transition-all hover:border-border-hover`}
                        onClick={() => setExpandedStep(expandedStep === i ? null : i)}
                      >
                        <img
                          src={`http://localhost:4100/screenshots/${step.file}`}
                          alt={`Step ${step.step}`}
                          className="w-full h-24 object-cover object-top"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="p-1.5">
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                            <span className="text-[10px] text-[var(--text-tertiary)] font-mono">#{String(step.step).padStart(2, "0")}</span>
                          </div>
                          <p className="text-[10px] text-[var(--text-secondary)] line-clamp-2 leading-tight">{step.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!hasSteps && result.result.screenshots.length > 0 && (
            <div>
              <h3 className="font-display text-lg font-semibold mb-3">Screenshots</h3>
              <div className="grid grid-cols-2 gap-3">
                {result.result.screenshots.map((ss, i) => (
                  <div key={i} className="rounded-xl overflow-hidden border border-border-dim bg-surface">
                    <img
                      src={`http://localhost:4100/screenshots/${ss}`}
                      alt={`Screenshot ${i + 1}`}
                      className="w-full"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <p className="p-2 text-xs text-[var(--text-tertiary)] font-mono">{ss}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="font-display text-lg font-semibold mb-3">Persona Report</h3>
            <div className="p-5 rounded-xl bg-surface border border-border-dim text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
              {result.result.textReport}
            </div>
          </div>

          {result.result.uxFeedback && (
            <div>
              <h3 className="font-display text-lg font-semibold mb-3">UX Feedback</h3>
              <div className="grid grid-cols-4 gap-3 mb-4">
                {["overall_score", "usability", "visual_design", "performance"].map(key => {
                  const val = result.result!.uxFeedback[key];
                  if (val === undefined) return null;
                  return (
                    <div key={key} className="p-3 rounded-xl bg-surface border border-border-dim text-center">
                      <p className="text-xs text-[var(--text-tertiary)] mb-1 font-mono">{key.replace(/_/g, " ")}</p>
                      <p className={`text-xl font-display font-bold ${
                        Number(val) >= 4 ? "text-sol-green" :
                        Number(val) >= 3 ? "text-[var(--status-warning)]" : "text-[var(--status-error)]"
                      }`}>
                        {String(val)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {Array.isArray(result.result.uxFeedback.issues_found) && (
                <div className="mb-3">
                  <p className="text-sm text-[var(--text-secondary)] mb-2 font-mono">Issues Found:</p>
                  <ul className="space-y-1">
                    {(result.result.uxFeedback.issues_found as string[]).map((issue, i) => (
                      <li key={i} className="text-sm text-[var(--status-error)] pl-3 border-l-2 border-[var(--status-error)]/30">{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {Array.isArray(result.result.uxFeedback.suggestions) && (
                <div>
                  <p className="text-sm text-[var(--text-secondary)] mb-2 font-mono">Suggestions:</p>
                  <ul className="space-y-1">
                    {(result.result.uxFeedback.suggestions as string[]).map((sug, i) => (
                      <li key={i} className="text-sm text-sol-blue pl-3 border-l-2 border-sol-blue/30">{sug}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <details className="rounded-xl bg-surface border border-border-dim">
            <summary className="p-3 text-sm text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] font-mono">
              Action Log ({result.result.actionLog.length} entries)
            </summary>
            <div className="px-3 pb-3 space-y-1">
              {result.result.actionLog.map((action, i) => (
                <p key={i} className="text-xs text-[var(--text-tertiary)] font-mono">{action}</p>
              ))}
            </div>
          </details>

          {result.result.txSignature && !result.result.txSignature.startsWith("pending") && (
            <div className="flex items-center gap-2 text-sm p-3 rounded-xl bg-surface border border-border-dim">
              <span className="text-[var(--text-secondary)]">41R Token Settlement:</span>
              <a
                href={`https://explorer.solana.com/tx/${result.result.txSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sol-green hover:text-sol-green/80 font-mono text-xs transition-colors"
              >
                {result.result.txSignature.slice(0, 24)}...
              </a>
              <span className="ml-auto text-xs text-sol-green font-mono">Confirmed on Devnet</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
