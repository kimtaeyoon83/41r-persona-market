const isProd = process.env.NODE_ENV === 'production';

function flag(name: string, prodSafe: boolean): boolean {
  const raw = process.env[name] === 'true';
  if (raw && isProd && !prodSafe) {
    console.warn(`[env] ${name}=true ignored in production (forced to false for safety)`);
    return false;
  }
  return raw;
}

export const skipPaymentVerify = flag('SKIP_PAYMENT_VERIFY', false);
export const useX402Fallback = flag('USE_X402_FALLBACK', true);

export function logEnvSummary() {
  console.log(
    `[env] NODE_ENV=${process.env.NODE_ENV ?? 'unset'} · ` +
    `payment verify: ${skipPaymentVerify ? 'SKIPPED' : 'ENABLED'} · ` +
    `x402 mode: ${useX402Fallback ? 'fallback' : 'x402'}`
  );
}
