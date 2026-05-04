"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useReadContract,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { bscTestnet } from "wagmi/chains";
import type { Address, Hex } from "viem";
import {
  autoTestBscApi,
  personaApi,
  testApi,
  API_BASE,
} from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";
import { DevDemoBanner } from "@/components/dev-demo-banner";

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
  };
}

interface Requirements {
  x402Version: 1;
  accepts: Array<{
    scheme: "exact";
    network: string; // e.g. eip155:97
    chainId: number;
    price: string; // "$0.10"
    amount: string; // smallest units
    currency: string;
    asset: Address | undefined;
    payTo: Address | undefined;
    description: string;
    eip712: {
      domain: { name: string; version: string; chainId: number; verifyingContract: Address | undefined };
      primaryType: string;
    };
  }>;
}

const AUTOTEST_PRICE_USDC = 0.10;
const MOCK_USDC_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

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

type PayStep = "idle" | "signing" | "relaying" | "running";

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** Switch/add BSC testnet on a specific provider (the connected MetaMask one),
 *  not on window.ethereum (which may be hijacked by Phantom). */
async function ensureBscTestnetOnProvider(provider: EthereumProvider): Promise<void> {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (parseInt(current, 16) === 97) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x61" }],
    });
  } catch (switchErr) {
    const code = (switchErr as { code?: number } | null)?.code;
    if (code !== 4902 && code !== -32603) throw switchErr;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x61",
          chainName: "BNB Smart Chain Testnet",
          nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
          rpcUrls: [
            process.env.NEXT_PUBLIC_BSC_RPC_URL ??
              "https://data-seed-prebsc-1-s1.binance.org:8545",
          ],
          blockExplorerUrls: ["https://testnet.bscscan.com"],
        },
      ],
    });
  }

  for (let i = 0; i < 20; i++) {
    const cur = (await provider.request({ method: "eth_chainId" })) as string;
    if (parseInt(cur, 16) === 97) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Chain switch did not complete within 5s");
}

export default function AutoTestBscPage() {
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();

  const getConnectedProvider = useCallback(async (): Promise<EthereumProvider | null> => {
    if (!connector?.getProvider) return null;
    try {
      const provider = (await connector.getProvider()) as EthereumProvider;
      return provider ?? null;
    } catch {
      return null;
    }
  }, [connector]);
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [pendingMintHash, setPendingMintHash] = useState<Hex | null>(null);
  const { isLoading: mintMining, isSuccess: mintConfirmed } = useWaitForTransactionReceipt({
    hash: pendingMintHash ?? undefined,
    query: { enabled: Boolean(pendingMintHash) },
  });

  const [tests, setTests] = useState<Test[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [selectedTest, setSelectedTest] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("");
  const [reqs, setReqs] = useState<Requirements | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoTestResult | null>(null);
  const [payStep, setPayStep] = useState<PayStep>("idle");
  const [paymentTx, setPaymentTx] = useState<string>("");
  const [payError, setPayError] = useState("");
  const [minting, setMinting] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const loadInitialData = useCallback(() => {
    setInitialLoading(true);
    setInitialError(null);
    Promise.all([
      testApi.list() as Promise<Test[]>,
      personaApi.list() as Promise<Persona[]>,
      autoTestBscApi.requirements() as Promise<Requirements>,
    ])
      .then(([t, p, r]) => {
        setTests(t.filter((x) => x.status === "active"));
        setPersonas(p);
        setReqs(r);
      })
      .catch((err) =>
        setInitialError(err instanceof Error ? err.message : "Failed to load page"),
      )
      .finally(() => setInitialLoading(false));
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const usdcAddress = reqs?.accepts[0]?.asset;
  const payee = reqs?.accepts[0]?.payTo;
  const amount = reqs?.accepts[0]?.amount ? BigInt(reqs.accepts[0].amount) : 0n;

  // Balance read
  const { data: balance, refetch: refetchBalance } = useReadContract({
    abi: MOCK_USDC_ABI,
    address: usdcAddress,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(usdcAddress && address) },
  });

  const balanceHuman = useMemo(() => {
    if (balance === undefined) return "—";
    return (Number(balance) / 1_000_000).toFixed(2);
  }, [balance]);

  const needsChainSwitch = isConnected && chainId !== bscTestnet.id;
  const onWrongChain = needsChainSwitch;

  const mintFaucet = async () => {
    if (!address || !usdcAddress) return;
    setMinting(true);
    setPayError("");
    try {
      // Get provider from the active connector, NOT window.ethereum — Phantom
      // often hijacks window.ethereum even when MetaMask is the connected wallet.
      const provider = await getConnectedProvider();
      if (!provider) throw new Error("Could not access connected wallet provider");
      await ensureBscTestnetOnProvider(provider);
      // Nudge wagmi state in the background; writeContract below doesn't
      // depend on wagmi's chainId since we pin chainId explicitly.
      switchChainAsync({ chainId: bscTestnet.id }).catch(() => {});
      const hash = await writeContractAsync({
        address: usdcAddress,
        abi: MOCK_USDC_ABI,
        functionName: "mint",
        args: [address, BigInt(100) * BigInt(1_000_000)],
        chainId: bscTestnet.id,
      });
      setPendingMintHash(hash);
      console.log("[mint] tx", hash);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Mint failed";
      if (msg.includes("User rejected") || msg.includes("rejected the request")) {
        setPayError("Mint cancelled.");
      } else if (msg.includes("does not match")) {
        setPayError("Chain switch didn't complete. Approve the network switch in MetaMask first.");
      } else {
        setPayError(`Mint failed: ${msg}`);
      }
    } finally {
      setMinting(false);
    }
  };

  // Refetch balance when mint tx confirms
  useEffect(() => {
    if (mintConfirmed && pendingMintHash) {
      refetchBalance();
      setPendingMintHash(null);
    }
  }, [mintConfirmed, pendingMintHash, refetchBalance]);

  const pollStatus = useCallback((jobId: string) => {
    const poll = async () => {
      try {
        const status = (await autoTestBscApi.status(jobId)) as AutoTestResult;
        setResult(status);
        if (status.status === "completed" || status.status === "failed") {
          setRunning(false);
          setPayStep("idle");
          return;
        }
        setTimeout(poll, 3000);
      } catch {
        setRunning(false);
        setPayStep("idle");
      }
    };
    poll();
  }, []);

  const handleRun = async () => {
    if (!selectedTest || !selectedPersona) return;
    if (!address || !isConnected) return;
    if (onWrongChain) {
      try {
        const provider = await getConnectedProvider();
        if (!provider) throw new Error("Connected wallet provider not available");
        await ensureBscTestnetOnProvider(provider);
        switchChainAsync({ chainId: bscTestnet.id }).catch(() => {});
      } catch (err) {
        setPayError(
          err instanceof Error
            ? `Please switch to BSC Testnet in MetaMask (${err.message}).`
            : "Please switch to BSC Testnet in MetaMask.",
        );
        return;
      }
    }
    if (!usdcAddress || !payee || amount === 0n) {
      setPayError("Payment requirements not loaded");
      return;
    }
    if (balance !== undefined && balance < amount) {
      setPayError("Insufficient USDC — claim from faucet first");
      return;
    }

    setPayError("");
    setPaymentTx("");
    setResult(null);
    setExpandedStep(null);

    // 1) Build + sign EIP-3009 TransferWithAuthorization
    setPayStep("signing");
    let signature: Hex;
    let nonce: Hex;
    let validAfter: bigint;
    let validBefore: bigint;
    try {
      const now = Math.floor(Date.now() / 1000);
      validAfter = 0n;
      validBefore = BigInt(now + 3600); // 1 hour window
      nonce = randomNonce();
      signature = await signTypedDataAsync({
        domain: {
          name: "USDC",
          version: "1",
          chainId: bscTestnet.id,
          verifyingContract: usdcAddress,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: address,
          to: payee,
          value: amount,
          validAfter,
          validBefore,
          nonce,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign cancelled";
      setPayError(msg.includes("User rejected") ? "Signature cancelled." : `Sign failed: ${msg}`);
      setPayStep("idle");
      return;
    }

    // 2) Build X-Payment header (base64)
    const envelope = {
      x402Version: 1,
      scheme: "exact",
      network: `eip155:${bscTestnet.id}`,
      payload: {
        signature,
        authorization: {
          from: address,
          to: payee,
          value: amount.toString(),
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce,
        },
      },
    };
    const xPayment = btoa(JSON.stringify(envelope));

    // 3) POST to server (verifies + settles)
    setPayStep("relaying");
    setRunning(true);
    try {
      const res = (await autoTestBscApi.run(
        { test_id: selectedTest, persona_id: selectedPersona },
        xPayment,
      )) as AutoTestResult & { payment?: { txHash: string; explorer: string } };
      setResult(res);
      if (res.payment?.txHash) setPaymentTx(res.payment.txHash);
      setPayStep("running");
      if (res.job_id) pollStatus(res.job_id);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Run failed");
      setRunning(false);
      setPayStep("idle");
    }
  };

  const selectedPersonaData = personas.find((p) => p.id === selectedPersona);
  const topExpertise = selectedPersonaData
    ? Object.entries(selectedPersonaData.vector.expertise)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
    : [];

  const steps = result?.result?.steps || [];
  const hasSteps = steps.length > 0;

  if (initialLoading) return <LoadingSpinner text="Loading tests and personas..." />;
  if (initialError) return <ErrorDisplay message={initialError} onRetry={loadInitialData} />;

  return (
    <div className="max-w-5xl">
      <DevDemoBanner subtitle="EVM/BSC testnet variant of auto-test. Solana is the canonical path — this flow is kept for x402 + EIP-3009 research." />
      <div className="flex items-start justify-between mb-2">
        <h1 className="font-display text-2xl font-bold">Auto Test — BSC Testnet</h1>
        <span className="px-2 py-1 rounded-md text-[11px] font-mono bg-yellow-400/10 text-yellow-300 border border-yellow-400/20">
          x402 · EIP-3009 · chainId 97
        </span>
      </div>
      <p className="text-[var(--text-secondary)] text-sm mb-6">
        Pay with MockUSDC on BSC testnet. MetaMask signs an EIP-3009 authorization — no gas from you; the server relays the transfer.
      </p>

      {/* Wallet + chain */}
      <div className="p-3 rounded-xl bg-surface border border-border-dim mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-yellow-400/10 flex items-center justify-center font-bold text-yellow-300">B</div>
          <div>
            {isConnected && address ? (
              <>
                <p className="text-sm font-mono text-[var(--text-primary)]">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </p>
                <p className="text-xs font-mono text-[var(--text-tertiary)]">
                  {onWrongChain ? `chainId ${chainId} — switch required` : `chainId ${chainId}`}
                </p>
              </>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">Wallet not connected</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isConnected && (
            <button
              onClick={() => {
                if (connectors[0]) {
                  connect({ connector: connectors[0] });
                } else {
                  setPayError("No wallet connector available — is MetaMask installed?");
                }
              }}
              className="px-3 py-1.5 text-sm rounded-lg bg-yellow-400/90 hover:bg-yellow-400 text-surface-base font-medium"
            >
              Connect MetaMask
            </button>
          )}
          {isConnected && onWrongChain && (
            <button
              onClick={() => switchChain({ chainId: bscTestnet.id })}
              className="px-3 py-1.5 text-sm rounded-lg bg-yellow-400/10 text-yellow-300 border border-yellow-400/20"
            >
              Switch to BSC Testnet
            </button>
          )}
          {isConnected && (
            <button
              onClick={() => disconnect()}
              className="px-3 py-1.5 text-sm rounded-lg border border-border-dim text-[var(--text-secondary)] hover:bg-surface-card"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Balance + faucet */}
      {isConnected && !onWrongChain && (
        <div className="p-3 rounded-xl bg-surface border border-border-dim mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--text-tertiary)] font-mono">MockUSDC balance</p>
            <p className="text-lg font-display font-bold">{balanceHuman} USDC</p>
          </div>
          <button
            onClick={mintFaucet}
            disabled={minting || mintMining || !usdcAddress}
            className="px-3 py-2 text-sm rounded-lg bg-sol-blue/10 hover:bg-sol-blue/15 text-sol-blue border border-sol-blue/20 font-mono disabled:opacity-50"
          >
            {minting ? "Approve in MetaMask…" : mintMining ? "Confirming…" : "Claim 100 USDC (faucet)"}
          </button>
        </div>
      )}

      {/* Test + persona */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">Select Test</label>
          <select value={selectedTest} onChange={(e) => setSelectedTest(e.target.value)}>
            <option value="">Choose a test...</option>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.targetUrl} ({t.id.slice(0, 8)})
              </option>
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
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id.slice(0, 8)} —{" "}
                {Object.entries(p.vector.expertise).sort(([, a], [, b]) => b - a)[0]?.[0] ||
                  "general"}
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
              <span
                key={k}
                className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-green/8 text-sol-green"
              >
                {k}: {(v * 100).toFixed(0)}%
              </span>
            ))}
          </div>
          <p className="text-xs text-[var(--text-tertiary)] italic mt-1">
            &quot;{selectedPersonaData.vector.voice_sample.slice(0, 120)}...&quot;
          </p>
        </div>
      )}

      {/* Price summary */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border-dim mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-yellow-400/10 flex items-center justify-center text-sm font-bold text-yellow-300">
            $
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">x402 Micropayment</p>
            <p className="text-xs text-[var(--text-tertiary)]">MockUSDC on BSC testnet</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-display font-bold text-yellow-300">${AUTOTEST_PRICE_USDC.toFixed(2)}</p>
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
          <p className="font-medium text-sol-green">Payment settled on BSC testnet</p>
          <a
            href={`https://testnet.bscscan.com/tx/${paymentTx}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-[var(--text-tertiary)] hover:text-sol-blue"
          >
            TX: {paymentTx.slice(0, 20)}...{paymentTx.slice(-8)}
          </a>
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={
          running ||
          !selectedTest ||
          !selectedPersona ||
          !isConnected ||
          onWrongChain ||
          payStep === "signing" ||
          payStep === "relaying"
        }
        className="w-full py-3 bg-yellow-400/90 hover:bg-yellow-400 disabled:bg-surface-card disabled:text-[var(--text-tertiary)] rounded-lg font-medium transition-colors mb-8 text-surface-base"
      >
        {!isConnected
          ? "Connect MetaMask to continue"
          : onWrongChain
            ? "Switch to BSC Testnet"
            : payStep === "signing"
              ? "Sign $0.10 authorization in MetaMask…"
              : payStep === "relaying"
                ? "Relaying payment on-chain…"
                : running
                  ? "Running Auto Test…"
                  : `Pay $${AUTOTEST_PRICE_USDC.toFixed(2)} & Run Auto Test`}
      </button>

      {result && (result.status === "queued" || result.status === "running") && (
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-sol-green font-mono">
              {result.status === "queued" ? "Queued..." : "Running..."}
            </span>
            <span className="text-[var(--text-tertiary)] font-mono">{result.progress || 0}%</span>
          </div>
          <div className="w-full h-2 bg-surface-card rounded-full overflow-hidden">
            <div
              className="h-full bg-sol-green rounded-full transition-all duration-500"
              style={{ width: `${result.progress || 0}%` }}
            />
          </div>
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
                  {steps.length} screenshots · {result.result.actionLog.length} actions
                </p>
              </div>
              {result.report_id && (
                <a
                  href={`/report/${result.report_id}`}
                  className="px-3 py-1.5 text-xs bg-sol-blue/10 text-sol-blue border border-sol-blue/20 rounded-lg hover:bg-sol-blue/15"
                >
                  View Full Report
                </a>
              )}
            </div>
          </div>

          {hasSteps && (
            <div>
              <h3 className="font-display text-lg font-semibold mb-4">Browser Session Timeline</h3>
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-border-dim" />
                <div className="space-y-3">
                  {steps.map((step, i) => {
                    const colors = PHASE_COLORS[step.phase] || PHASE_COLORS.init;
                    const isExpanded = expandedStep === i;
                    return (
                      <div key={i} className="relative pl-10">
                        <div
                          className={`absolute left-[11px] top-3 w-[10px] h-[10px] rounded-full ${colors.dot} ring-2 ring-surface-base`}
                        />
                        <div
                          className={`rounded-xl border ${colors.border} ${isExpanded ? colors.bg : "bg-surface/50"} cursor-pointer transition-all`}
                          onClick={() => setExpandedStep(isExpanded ? null : i)}
                        >
                          <div className="flex items-center gap-3 p-3">
                            <span className={`text-xs font-mono ${colors.text} w-6 text-center shrink-0`}>
                              {String(step.step).padStart(2, "0")}
                            </span>
                            <span
                              className={`text-[11px] font-mono px-1.5 py-0.5 rounded-md ${colors.bg} ${colors.text} shrink-0`}
                            >
                              {PHASE_LABELS[step.phase]}
                            </span>
                            <p className="text-sm text-[var(--text-primary)] truncate flex-1">
                              {step.label}
                            </p>
                          </div>
                          {isExpanded && (
                            <div className="px-3 pb-3">
                              <div className="rounded-lg overflow-hidden border border-border-dim bg-surface-base">
                                {step.file.startsWith("http") ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={step.file} alt={step.label} className="w-full" />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={`${API_BASE}/screenshots/${step.file}`}
                                    alt={step.label}
                                    className="w-full"
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div>
            <h3 className="font-display text-lg font-semibold mb-3">Persona Report</h3>
            <div className="p-5 rounded-xl bg-surface border border-border-dim text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
              {result.result.textReport}
            </div>
          </div>

          <details className="rounded-xl bg-surface border border-border-dim">
            <summary className="p-3 text-sm text-[var(--text-secondary)] cursor-pointer font-mono">
              Action Log ({result.result.actionLog.length} entries)
            </summary>
            <div className="px-3 pb-3 space-y-1">
              {result.result.actionLog.map((action, i) => (
                <p key={i} className="text-xs text-[var(--text-tertiary)] font-mono">
                  {action}
                </p>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
