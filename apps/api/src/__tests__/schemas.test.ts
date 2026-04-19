import { describe, it, expect } from 'vitest';
import {
  registerTestBodySchema,
  registerTesterBodySchema,
  updateTesterBodySchema,
  submitReportBodySchema,
  autotestRunBodySchema,
  personaGenerateBodySchema,
} from '../schemas/index.js';

const VALID_WALLET = '8Vm3ys3kwLSy2qThejn56E2j6fptwSE2qcLkEeiLrdB8';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_URL = 'https://example.com/page';

describe('registerTestBodySchema', () => {
  it('accepts a minimal valid body', () => {
    const r = registerTestBodySchema.safeParse({
      target_url: VALID_URL,
      company_wallet: VALID_WALLET,
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-URL target_url', () => {
    const r = registerTestBodySchema.safeParse({
      target_url: 'not a url',
      company_wallet: VALID_WALLET,
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed wallet', () => {
    const r = registerTestBodySchema.safeParse({
      target_url: VALID_URL,
      company_wallet: 'short',
    });
    expect(r.success).toBe(false);
  });

  it('rejects negative budget', () => {
    const r = registerTestBodySchema.safeParse({
      target_url: VALID_URL,
      company_wallet: VALID_WALLET,
      budget_usdc: -10,
    });
    expect(r.success).toBe(false);
  });
});

describe('registerTesterBodySchema', () => {
  it('accepts a valid body with profile', () => {
    const r = registerTesterBodySchema.safeParse({
      wallet_address: VALID_WALLET,
      display_name: 'Alice',
      profile: {
        expertise: ['defi', 'wallets'],
        experience_level: 'intermediate',
        crypto_experience: 'advanced',
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects bad crypto_experience enum', () => {
    const r = registerTesterBodySchema.safeParse({
      wallet_address: VALID_WALLET,
      display_name: 'Alice',
      profile: {
        expertise: ['defi'],
        experience_level: 'intermediate',
        crypto_experience: 'super-expert',
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty display_name', () => {
    const r = registerTesterBodySchema.safeParse({
      wallet_address: VALID_WALLET,
      display_name: '   ',
    });
    expect(r.success).toBe(false);
  });
});

describe('updateTesterBodySchema', () => {
  it('requires at least one field', () => {
    const r = updateTesterBodySchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('accepts display_name only', () => {
    const r = updateTesterBodySchema.safeParse({ display_name: 'Bob' });
    expect(r.success).toBe(true);
  });
});

describe('submitReportBodySchema', () => {
  it('rejects fully empty report', () => {
    const r = submitReportBodySchema.safeParse({
      tester_addr: VALID_WALLET,
      test_id: VALID_UUID,
      checklist_results: [],
      scenario_log: [],
      questionnaire_answers: [],
    });
    expect(r.success).toBe(false);
  });

  it('accepts report with only questionnaire', () => {
    const r = submitReportBodySchema.safeParse({
      tester_addr: VALID_WALLET,
      test_id: VALID_UUID,
      questionnaire_answers: [{ id: 'q1', answer: 5 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-uuid test_id', () => {
    const r = submitReportBodySchema.safeParse({
      tester_addr: VALID_WALLET,
      test_id: 'not-a-uuid',
      checklist_results: [{ id: 'c1', status: 'pass' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('autotestRunBodySchema', () => {
  it('accepts valid ids without payment_tx (402 path)', () => {
    const r = autotestRunBodySchema.safeParse({
      test_id: VALID_UUID,
      persona_id: VALID_UUID,
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing persona_id', () => {
    const r = autotestRunBodySchema.safeParse({
      test_id: VALID_UUID,
    });
    expect(r.success).toBe(false);
  });
});

describe('personaGenerateBodySchema', () => {
  it('requires a wallet', () => {
    const r = personaGenerateBodySchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('accepts a valid wallet', () => {
    const r = personaGenerateBodySchema.safeParse({ tester_addr: VALID_WALLET });
    expect(r.success).toBe(true);
  });
});
