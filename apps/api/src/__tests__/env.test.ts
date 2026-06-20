import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('env flags', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('SKIP_PAYMENT_VERIFY=true is honored in non-production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SKIP_PAYMENT_VERIFY = 'true';
    const mod = await import('../config/env.js');
    expect(mod.skipPaymentVerify).toBe(true);
  });

  it('SKIP_PAYMENT_VERIFY=true is forced false in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SKIP_PAYMENT_VERIFY = 'true';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('../config/env.js');
    expect(mod.skipPaymentVerify).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('SKIP_PAYMENT_VERIFY=true ignored in production')
    );
    warn.mockRestore();
  });

  it('SKIP_PAYMENT_VERIFY unset defaults to false', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SKIP_PAYMENT_VERIFY;
    const mod = await import('../config/env.js');
    expect(mod.skipPaymentVerify).toBe(false);
  });
});
