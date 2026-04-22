import { z } from 'zod';
import type { RequestHandler } from 'express';
import { walletAddressSchema, urlSchema, uuidSchema, txSignatureSchema } from './common.js';

export const registerTestBodySchema = z.object({
  target_url: urlSchema,
  company_wallet: walletAddressSchema,
  requirements: z.string().max(8000).optional(),
  budget_usdc: z.number().positive().max(10_000).optional(),
  reward_per_tester: z.number().positive().max(100).optional(),
  deposit_tx_signature: txSignatureSchema.optional(),
  enable_auto_test: z.boolean().optional(),
});

export const registerTesterBodySchema = z.object({
  wallet_address: walletAddressSchema,
  display_name: z.string().trim().min(1).max(80),
  profile: z
    .object({
      expertise: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
      experience_level: z.string().trim().min(1).max(40),
      age_range: z.enum(['10s', '20s', '30s', '40s', '50s', '60+']).optional(),
      crypto_experience: z.enum(['none', 'beginner', 'intermediate', 'advanced']).optional(),
      primary_device: z.enum(['mobile', 'desktop']).optional(),
    })
    .catchall(z.unknown())
    .optional(),
});

export const updateTesterBodySchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
  profile: z.record(z.unknown()).optional(),
}).refine(
  (v) => v.display_name !== undefined || v.profile !== undefined,
  { message: 'No fields to update' },
);

export const submitReportBodySchema = z.object({
  tester_addr: walletAddressSchema,
  test_id: uuidSchema,
  checklist_results: z.array(z.unknown()).default([]),
  scenario_log: z.array(z.unknown()).default([]),
  questionnaire_answers: z.array(z.unknown()).default([]),
  screenshots: z.array(z.string().max(2048)).max(50).optional(),
}).refine(
  (v) => v.checklist_results.length > 0 || v.scenario_log.length > 0 || v.questionnaire_answers.length > 0,
  { message: 'At least one of checklist_results, scenario_log, questionnaire_answers must be non-empty' },
);

export const autotestRunBodySchema = z.object({
  test_id: uuidSchema,
  persona_id: uuidSchema,
  payment_tx: txSignatureSchema.optional(),
  mode: z.string().max(40).optional(),
});

export const personaGenerateBodySchema = z.object({
  tester_addr: walletAddressSchema,
});

export const generateDiagnosisBodySchema = z.object({
  company_wallet: walletAddressSchema,
});

export const retryAutotestBodySchema = z.object({
  company_wallet: walletAddressSchema,
  /** Optional cap on how many personas to (re)queue. Defaults to 3 —
   *  same as the matcher used by POST /api/test/register. */
  max_personas: z.number().int().positive().max(10).optional(),
  /** When true, persona reports below the 1.5 reward threshold for
   *  this test get deleted (along with their settlements rows) so the
   *  "already-has-a-report" skip doesn't filter them out of the
   *  matcher's picks. Safe default is false — we only re-queue
   *  personas that have no prior report at all. */
  force_retry_low_quality: z.boolean().optional(),
});

export type RegisterTestBody = z.infer<typeof registerTestBodySchema>;
export type RegisterTesterBody = z.infer<typeof registerTesterBodySchema>;
export type UpdateTesterBody = z.infer<typeof updateTesterBodySchema>;
export type SubmitReportBody = z.infer<typeof submitReportBodySchema>;
export type AutotestRunBody = z.infer<typeof autotestRunBodySchema>;
export type PersonaGenerateBody = z.infer<typeof personaGenerateBodySchema>;
export type RetryAutotestBody = z.infer<typeof retryAutotestBodySchema>;
export type GenerateDiagnosisBody = z.infer<typeof generateDiagnosisBodySchema>;

// Returns an Express RequestHandler that validates req.body against the
// schema. Kept fully generic so the route's param/query types aren't
// narrowed when the handler chain is composed.
export function validateBody(schema: z.ZodTypeAny): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      res.status(400).json({
        error: 'Invalid request body',
        field: first?.path.join('.') || null,
        message: first?.message || 'validation failed',
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    req.body = parsed.data;
    next();
  };
}
