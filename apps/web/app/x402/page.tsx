"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/api";
import { DevDemoBanner } from "@/components/dev-demo-banner";

const API = API_BASE;

interface Step1Result {
  status: number;
  price?: string;
  network?: string;
  payTo?: string;
  message?: string;
  raw?: unknown;
}

interface Step2Result {
  status: number;
  body?: unknown;
  amountPaid?: string;
  txSignature?: string;
  error?: string;
}

export default function X402Page() {
  const [step1Loading, setStep1Loading] = useState(false);
  const [step1Result, setStep1Result] = useState<Step1Result | null>(null);
  const [step2Loading, setStep2Loading] = useState(false);
  const [step2Result, setStep2Result] = useState<Step2Result | null>(null);

  const callWithout = async () => {
    setStep1Loading(true);
    setStep1Result(null);
    try {
      const res = await fetch(`${API}/api/x402-demo/test-402`);
      const data = await res.json();
      // Backend returns { status, paymentRequiredHeader: { accepts: [{ amount, network, payTo }] }, ... }
      const accepts = data.paymentRequiredHeader?.accepts?.[0];
      const amount = accepts?.amount;
      const price = amount ? `$${(Number(amount) / 1_000_000).toFixed(4)}` : undefined;
      setStep1Result({
        status: data.status || 402,
        price,
        network: accepts?.network,
        payTo: accepts?.payTo,
        message: data.paymentRequiredHeader?.error || "Payment Required",
        raw: data,
      });
    } catch (err) {
      setStep1Result({
        status: 0,
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setStep1Loading(false);
    }
  };

  const callWith = async () => {
    setStep2Loading(true);
    setStep2Result(null);
    try {
      const res = await fetch(`${API}/api/x402-demo/test-paid`);
      const data = await res.json();
      // Backend returns { info, status, body, payment: { network, signerAddress }, elapsedMs }
      // or on error: { error, details, hints }
      setStep2Result({
        status: data.status || res.status,
        body: data.error ? { info: data.info, details: data.details, hints: data.hints } : data,
        amountPaid: data.status === 200 ? "$0.001" : undefined,
        txSignature: data.payment?.txSignature,
        error: data.error || (data.status !== 200 ? data.hint : undefined),
      });
    } catch (err) {
      setStep2Result({
        status: 0,
        error: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setStep2Loading(false);
    }
  };

  const flowSteps = [
    { label: "Client Request", sub: "GET /api/resource", color: "sol-blue" },
    { label: "402 Payment Required", sub: "Server responds with price", color: "sol-purple" },
    { label: "Client Signs USDC Transfer", sub: "Solana transaction built", color: "sol-purple" },
    { label: "Retry with Payment Header", sub: "X-Payment: <signed-tx>", color: "sol-blue" },
    { label: "200 OK", sub: "Access granted", color: "sol-green" },
  ];

  return (
    <div className="max-w-5xl">
      <DevDemoBanner subtitle="Sandbox for the x402 micropayment protocol. End users do not reach this page." />

      {/* Header */}
      <h1 className="font-display text-2xl font-bold mb-2">x402 Micropayment Demo</h1>
      <p className="text-[var(--text-secondary)] text-sm mb-8">
        HTTP 402 Payment Required protocol on Solana — pay-per-API-call
      </p>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
        {/* Panel 1: Without Payment */}
        <div className="p-5 rounded-xl bg-surface border border-border-dim">
          <h2 className="font-display text-lg font-semibold mb-1">Without Payment</h2>
          <p className="text-xs text-[var(--text-tertiary)] mb-4 font-mono">
            Raw request with no x402 header
          </p>

          <button
            onClick={callWithout}
            disabled={step1Loading}
            className="w-full py-2.5 bg-surface-card hover:bg-surface-card-hover disabled:opacity-50 border border-border-dim rounded-lg font-mono text-sm transition-colors mb-4"
          >
            {step1Loading ? "Calling..." : "Call /api/hello (no payment)"}
          </button>

          {step1Loading && (
            <div className="space-y-2">
              <div className="h-4 rounded shimmer" />
              <div className="h-4 rounded shimmer w-3/4" />
            </div>
          )}

          {step1Result && !step1Loading && (
            <div className="space-y-3 fade-in">
              {/* Status */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-tertiary)] font-mono">HTTP Status:</span>
                <span
                  className={`text-sm font-mono font-bold ${
                    step1Result.status === 402
                      ? "text-[var(--status-warning)]"
                      : step1Result.status === 0
                        ? "text-[var(--status-error)]"
                        : "text-[var(--text-primary)]"
                  }`}
                >
                  {step1Result.status || "ERR"}
                </span>
              </div>

              {/* Payment requirements */}
              {(step1Result.price || step1Result.network || step1Result.payTo) && (
                <div className="p-3 rounded-lg bg-surface-elevated border border-[var(--status-warning)]/20">
                  <p className="text-xs text-[var(--status-warning)] font-mono mb-2">
                    Payment Requirements
                  </p>
                  <div className="space-y-1.5">
                    {step1Result.price && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-tertiary)] font-mono">Price:</span>
                        <span className="text-xs text-[var(--text-primary)] font-mono">
                          {step1Result.price} USDC
                        </span>
                      </div>
                    )}
                    {step1Result.network && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-tertiary)] font-mono">Network:</span>
                        <span className="text-xs text-[var(--text-primary)] font-mono">
                          {step1Result.network}
                        </span>
                      </div>
                    )}
                    {step1Result.payTo && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-tertiary)] font-mono">Pay To:</span>
                        <span className="text-xs text-[var(--text-primary)] font-mono truncate ml-2 max-w-[180px]">
                          {step1Result.payTo}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Message */}
              <div className="p-3 rounded-lg bg-[var(--status-error)]/5 border border-[var(--status-error)]/20">
                <p className="text-xs text-[var(--status-error)]">
                  {step1Result.message || "Payment Required — access denied without USDC payment"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Panel 2: With x402 Payment */}
        <div className="p-5 rounded-xl bg-surface border border-border-dim">
          <h2 className="font-display text-lg font-semibold mb-1">With x402 Payment</h2>
          <p className="text-xs text-[var(--text-tertiary)] mb-4 font-mono">
            Server-side keypair signs USDC transfer automatically
          </p>

          <button
            onClick={callWith}
            disabled={step2Loading}
            className="w-full py-2.5 bg-sol-green hover:bg-sol-green/80 disabled:opacity-50 rounded-lg font-mono text-sm text-surface-base font-medium transition-colors mb-4"
          >
            {step2Loading ? "Processing payment..." : "Call /api/hello (with x402 payment)"}
          </button>

          {step2Loading && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-sol-green pulse-dot" />
                <span className="text-xs text-sol-green font-mono">
                  Signing USDC transfer on Solana...
                </span>
              </div>
              <div className="space-y-2">
                <div className="h-4 rounded shimmer" />
                <div className="h-4 rounded shimmer w-2/3" />
                <div className="h-4 rounded shimmer w-1/2" />
              </div>
            </div>
          )}

          {step2Result && !step2Loading && (
            <div className="space-y-3 fade-in">
              {/* Status */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-tertiary)] font-mono">HTTP Status:</span>
                <span
                  className={`text-sm font-mono font-bold ${
                    step2Result.status === 200
                      ? "text-sol-green"
                      : step2Result.status === 0
                        ? "text-[var(--status-error)]"
                        : "text-[var(--status-warning)]"
                  }`}
                >
                  {step2Result.status || "ERR"}
                </span>
              </div>

              {/* Success */}
              {!step2Result.error && (
                <>
                  {/* Response body */}
                  <div className="p-3 rounded-lg bg-sol-green/5 border border-sol-green/20">
                    <p className="text-xs text-sol-green font-mono mb-1">Response Body</p>
                    <pre className="text-xs text-[var(--text-primary)] font-mono overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(step2Result.body, null, 2)}
                    </pre>
                  </div>

                  {/* Payment amount */}
                  {step2Result.amountPaid && (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-border-dim">
                      <span className="text-xs text-[var(--text-tertiary)] font-mono">
                        Amount Paid:
                      </span>
                      <span className="text-sm text-sol-green font-mono font-bold">
                        {step2Result.amountPaid} USDC
                      </span>
                    </div>
                  )}

                  {/* Transaction signature */}
                  {step2Result.txSignature && (
                    <div className="p-3 rounded-lg bg-surface-elevated border border-border-dim">
                      <p className="text-xs text-[var(--text-tertiary)] font-mono mb-1">
                        Transaction Signature
                      </p>
                      <a
                        href={`https://explorer.solana.com/tx/${step2Result.txSignature}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-sol-green hover:text-sol-green/80 font-mono transition-colors break-all"
                      >
                        {step2Result.txSignature}
                      </a>
                    </div>
                  )}
                </>
              )}

              {/* Error / No USDC */}
              {step2Result.error && (
                <div className="p-3 rounded-lg bg-[var(--status-error)]/5 border border-[var(--status-error)]/20 space-y-2">
                  <p className="text-xs text-[var(--status-error)] font-mono">
                    {step2Result.error}
                  </p>
                  {step2Result.status === 402 && (
                    <div className="pt-2 border-t border-[var(--status-error)]/10">
                      <p className="text-xs text-[var(--text-secondary)] mb-1">Server wallet needs devnet USDC:</p>
                      <a
                        href="https://faucet.circle.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-sol-blue hover:text-sol-blue/80 font-mono"
                      >
                        faucet.circle.com &rarr; Solana Devnet &rarr; USDC
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* How x402 Works */}
      <div className="mb-10">
        <h2 className="font-display text-lg font-semibold mb-4">How x402 Works</h2>
        <div className="p-5 rounded-xl bg-surface border border-border-dim">
          <div className="flex items-center gap-0 overflow-x-auto pb-2">
            {flowSteps.map((step, i) => (
              <div key={i} className="flex items-center shrink-0">
                <div className="flex flex-col items-center text-center min-w-[140px]">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-mono font-bold mb-2 ${
                      step.color === "sol-green"
                        ? "bg-sol-green/15 text-sol-green border border-sol-green/30"
                        : step.color === "sol-purple"
                          ? "bg-sol-purple/15 text-sol-purple border border-sol-purple/30"
                          : "bg-sol-blue/15 text-sol-blue border border-sol-blue/30"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <p className="text-xs text-[var(--text-primary)] font-medium leading-tight">
                    {step.label}
                  </p>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-mono mt-0.5 leading-tight">
                    {step.sub}
                  </p>
                </div>
                {i < flowSteps.length - 1 && (
                  <div className="flex items-center mx-1 mb-6">
                    <div className="w-8 h-px bg-border-hover" />
                    <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-border-hover" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="p-5 rounded-xl bg-surface-elevated border border-sol-green/20 sol-glow">
        <h3 className="font-display text-sm font-semibold text-sol-green mb-3">
          Why Solana for Micropayments?
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-surface border border-border-dim text-center">
            <p className="text-xs text-[var(--text-tertiary)] font-mono mb-2">
              Cost per Transaction
            </p>
            <div className="flex items-baseline justify-center gap-3">
              <div>
                <span className="text-lg font-display font-bold text-sol-green">$0.00025</span>
                <p className="text-[10px] text-[var(--text-tertiary)] font-mono mt-0.5">
                  Solana tx fee
                </p>
              </div>
              <span className="text-[var(--text-tertiary)] font-mono text-sm">vs</span>
              <div>
                <span className="text-lg font-display font-bold text-[var(--status-error)]">
                  $0.387
                </span>
                <p className="text-[10px] text-[var(--text-tertiary)] font-mono mt-0.5">
                  Stripe per-tx
                </p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-lg bg-surface border border-border-dim text-center">
            <p className="text-xs text-[var(--text-tertiary)] font-mono mb-2">Savings</p>
            <span className="text-3xl font-display font-bold sol-gradient-text">1,500x</span>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              cheaper for micropayments
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
