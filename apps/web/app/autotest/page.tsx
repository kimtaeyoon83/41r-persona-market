"use client";

import { useEffect, useState, useCallback } from "react";
import { testApi, personaApi, autoTestApi, API_BASE } from "@/lib/api";
import { useWalletContext } from "@/components/wallet-provider";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";
import { Topbar } from "@/components/topbar";
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [selectedTest, setSelectedTest] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoTestResult | null>(null);
  const [polling, setPolling] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [payStep, setPayStep] = useState<PayStep>("idle");
  const [paymentTx, setPaymentTx] = useState<string>("");
  const [payError, setPayError] = useState("");

  const loadInitialData = () => {
    setInitialLoading(true);
    setInitialError(null);
    Promise.all([
      testApi.list() as Promise<Test[]>,
      personaApi.list() as Promise<Persona[]>,
    ])
      .then(([t, p]) => {
        setTests(t.filter(x => x.status === "active"));
        setPersonas(p);
      })
      .catch((err) => setInitialError(err instanceof Error ? err.message : "Failed to load tests and personas"))
      .finally(() => setInitialLoading(false));
  };

  useEffect(() => {
    loadInitialData();
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

  if (initialLoading) return <LoadingSpinner text="Loading tests and personas..." />;
  if (initialError) return <ErrorDisplay message={initialError} onRetry={loadInitialData} />;

  return (
    <div className="max-w-5xl">
      <Topbar
        title="AutoTest"
        subtitle="Run headless persona panels · $0.10 per run"
      />
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
        <div className="hf-card p-3 mb-4 text-sm">
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
      <div className="flex items-center justify-between hf-card p-3 mb-4">
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
        <LiveTheater result={result} polling={polling} personaVoice={personas.find(p => p.id === selectedPersona)?.vector?.voice_sample} />
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
              <h3 className="t-display-s mb-4">Browser Session Timeline</h3>

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
                                  src={`${API_BASE}/screenshots/${step.file}`}
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
                          src={`${API_BASE}/screenshots/${step.file}`}
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
              <h3 className="t-display-s mb-3">Screenshots</h3>
              <div className="grid grid-cols-2 gap-3">
                {result.result.screenshots.map((ss, i) => (
                  <div key={i} className="rounded-xl overflow-hidden border border-border-dim bg-surface">
                    <img
                      src={`${API_BASE}/screenshots/${ss}`}
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
            <h3 className="t-display-s mb-3">Persona Report</h3>
            <div className="hf-card p-5 text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
              {result.result.textReport}
            </div>
          </div>

          {result.result.uxFeedback && (
            <div>
              <h3 className="t-display-s mb-3">UX Feedback</h3>
              {/* Score grid — 4 metrics the persona-engine surfaces for every run */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { key: "overall_score", label: "Overall" },
                  { key: "usability", label: "Usability" },
                  { key: "visual_design", label: "Visual" },
                  { key: "performance", label: "Performance" },
                ].map(({ key, label }) => {
                  const val = result.result!.uxFeedback[key];
                  const hasVal = val !== undefined && val !== null;
                  return (
                    <div key={key} className="hf-card p-4 text-center">
                      <p className="text-[10px] text-[var(--text-tertiary)] font-mono uppercase tracking-wider mb-1">{label}</p>
                      {hasVal ? (
                        <p className={`text-2xl font-display font-bold ${
                          Number(val) >= 4 ? "text-sol-green" :
                          Number(val) >= 3 ? "text-[var(--status-warning)]" : "text-[var(--status-error)]"
                        }`}>
                          {String(val)}
                          <span className="text-xs font-normal text-[var(--text-tertiary)] ml-1">/ 5</span>
                        </p>
                      ) : (
                        <p className="text-2xl font-display font-bold text-[var(--text-tertiary)]">—</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Issues / suggestions — parallel columns so the reader can weigh what broke vs what to try */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-[var(--status-error)]/20 bg-[var(--status-error)]/5">
                  <p className="text-xs font-mono uppercase tracking-wider text-[var(--status-error)] mb-2">Issues found</p>
                  {Array.isArray(result.result.uxFeedback.issues_found) && (result.result.uxFeedback.issues_found as string[]).length > 0 ? (
                    <ul className="space-y-1.5">
                      {(result.result.uxFeedback.issues_found as string[]).map((issue, i) => (
                        <li key={i} className="text-sm text-[var(--text-primary)] leading-snug">• {issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--text-tertiary)]">No issues flagged.</p>
                  )}
                </div>

                <div className="p-4 rounded-xl border border-sol-blue/20 bg-sol-blue/5">
                  <p className="text-xs font-mono uppercase tracking-wider text-sol-blue mb-2">Suggestions</p>
                  {Array.isArray(result.result.uxFeedback.suggestions) && (result.result.uxFeedback.suggestions as string[]).length > 0 ? (
                    <ul className="space-y-1.5">
                      {(result.result.uxFeedback.suggestions as string[]).map((sug, i) => (
                        <li key={i} className="text-sm text-[var(--text-primary)] leading-snug">• {sug}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--text-tertiary)]">No suggestions this run.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <details className="hf-card">
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
            <div className="flex items-center gap-2 text-sm hf-card p-3">
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

// ─── Live Theater ─────────────────────────────────────────────────────────
// Browser viewport + persona "thinking out loud" timeline. Shown only while
// a run is queued/running; swaps out for the final result panels.

function stylizedMonologue(line: string): string {
  // A few light reframings so action log reads more like a person's narration.
  if (/^\s*(open|navigate|goto|visit)/i.test(line)) return `OK, let me open this up.`;
  if (/click.*(connect|wallet|sign)/i.test(line)) return `Connecting my wallet — hope the popup behaves.`;
  if (/click/i.test(line)) return `Clicking that.`;
  if (/(type|fill|enter).*(amount|value)/i.test(line)) return `Typing a weird amount to see how it reacts.`;
  if (/(slippage|gas|fee)/i.test(line)) return `Let me check slippage settings — that's usually where things go sideways.`;
  if (/scroll/i.test(line)) return `Scrolling through to see if anything else catches my eye.`;
  if (/wait|loading|spinner/i.test(line)) return `Still loading. Fine — but a hint of progress would help.`;
  if (/error|failed|reject/i.test(line)) return `That errored. Taking note.`;
  return line;
}

function LiveTheater({
  result,
  polling,
  personaVoice,
}: {
  result: AutoTestResult;
  polling: boolean;
  personaVoice?: string;
}) {
  const steps = result.result?.steps || [];
  const actionLog = result.result?.actionLog || [];
  const latestScreenshot =
    steps.length > 0 ? steps[steps.length - 1] : null;
  const progress = result.progress ?? 0;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="chip success">
            <span className="chip-dot pulse-dot" />
            Live · {result.status}
          </span>
          <span className="addr">polling every 3s</span>
        </div>
        <span className="money text-[var(--fg-1)]">{progress}%</span>
      </div>

      <div className="h-1.5 rounded-full mb-4 overflow-hidden" style={{ background: "var(--bg-2)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progress}%`, background: "var(--accent)" }}
        />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        {/* Browser viewport */}
        <div className="hf-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--line-1)]" style={{ background: "var(--bg-2)" }}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--danger)" }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--warn)" }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--success)" }} />
            <span className="addr ml-2 truncate">
              {latestScreenshot ? latestScreenshot.label : "browser booting…"}
            </span>
          </div>
          <div className="bg-[var(--bg-2)] min-h-[300px] grid place-items-center relative">
            {latestScreenshot ? (
              <img
                src={latestScreenshot.file.startsWith("http") ? latestScreenshot.file : `${API_BASE}/screenshots/${latestScreenshot.file}`}
                alt={latestScreenshot.label}
                className="w-full h-auto"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 py-12">
                <div className="w-5 h-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                <span className="t-caption">Spinning up the browser…</span>
              </div>
            )}
          </div>
        </div>

        {/* Persona monologue */}
        <div className="hf-card overflow-hidden flex flex-col">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--line-1)]" style={{ background: "var(--bg-2)" }}>
            <div
              className="w-9 h-9 rounded-[var(--r-2)] border border-[var(--line-1)] grid place-items-center"
              style={{
                background: "radial-gradient(circle at 30% 30%, var(--sol-green) 0%, transparent 45%), radial-gradient(circle at 70% 70%, var(--sol-purple) 0%, transparent 50%), var(--bg-3)",
              }}
            />
            <div>
              <div className="t-body font-medium">Persona thinking</div>
              <div className="t-caption">in character</div>
            </div>
          </div>
          {personaVoice && (
            <div className="px-4 py-3 border-b border-[var(--line-1)]">
              <div className="t-label mb-1.5" style={{ color: "var(--accent)" }}>Voice</div>
              <p className="t-body-s italic leading-snug line-clamp-3">&ldquo;{personaVoice}&rdquo;</p>
            </div>
          )}
          <div className="flex-1 overflow-auto max-h-[360px] relative" style={{ paddingLeft: 28 }}>
            <div
              className="absolute left-[13px] top-3 bottom-3 w-px"
              style={{ background: "var(--line-1)" }}
            />
            <div className="py-2">
              {actionLog.length === 0 ? (
                <p className="px-4 py-3 t-caption">Waiting for the first move…</p>
              ) : (
                actionLog.slice(-12).map((line, i, arr) => {
                  const elapsed = i === arr.length - 1;
                  const mono = stylizedMonologue(line);
                  return (
                    <div key={i} className="relative pr-4 py-2">
                      <span
                        className="absolute -left-[22px] top-3 w-2.5 h-2.5 rounded-full"
                        style={{
                          background: elapsed ? "var(--accent)" : "var(--bg-0)",
                          border: `2px solid ${elapsed ? "var(--accent)" : "var(--line-2)"}`,
                        }}
                      />
                      <div className="addr mb-0.5">
                        {String(Math.floor((i / Math.max(arr.length - 1, 1)) * progress)).padStart(2, "0")}%
                      </div>
                      <p className="t-body-s">
                        {mono !== line ? (
                          <>
                            {mono}
                            <span className="t-caption block mt-0.5 opacity-70">· {line}</span>
                          </>
                        ) : (
                          line
                        )}
                      </p>
                    </div>
                  );
                })
              )}
              {polling && (
                <div className="px-4 py-2 t-caption opacity-70">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] pulse-dot mr-2" />
                  listening for the next step…
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
