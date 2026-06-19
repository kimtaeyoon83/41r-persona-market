// Session planner — the shared rail behind both trigger entry points
// (design doc v0.4 §3.5). A session's three axes are independent:
//   - trigger:  who started it (user | campaign | cron)
//   - tier:     where it runs  (T0 user device | T1 sandbox | T2 TEE)
//   - mode:     how it observes (capture_react now | autonomous = Mode C)
// ownership/signing is always the user's key (Privy Ed25519 → Sui).
//
// Both a user-initiated request and a platform-automated (campaign/cron)
// request funnel through planSession(): it records the trigger source and
// enforces the cross-axis rules (gates + sandbox requirements) so the two
// entries can coexist without each re-implementing the constraints.
//
// Pure: no I/O. Dispatch (running the planned session through the capture
// pipeline / future agent) is the caller's job — this only validates +
// resolves the plan.

export type TriggerSource = 'user' | 'campaign' | 'cron';
export type SandboxTier = 'T0' | 'T1' | 'T2';
/** capture_react = current (system captures, persona reacts).
 *  autonomous    = Mode C per-persona traversal — gated on think-aloud. */
export type ExecutionMode = 'capture_react' | 'autonomous';

export type SessionRequest = {
  source: TriggerSource;
  targetUrl: string;
  /** Specific persona, or omit for cohort sampling. */
  personaId?: string;
  tier: SandboxTier;
  mode: ExecutionMode;
  /** True when the session decrypts a sealed secret asset (§4.5) —
   *  forces a sandbox tier so the plaintext never hits a user device. */
  secretAsset?: boolean;
};

export type SessionPlan = SessionRequest & {
  /** Human-readable resolution, for logs/audit. */
  summary: string;
};

export class SessionPlanError extends Error {
  constructor(
    readonly code: 'mode_c_gated' | 'secret_requires_sandbox',
    message: string,
  ) {
    super(message);
    this.name = 'SessionPlanError';
  }
}

const TIER_RANK: Record<SandboxTier, number> = { T0: 0, T1: 1, T2: 2 };

/**
 * Validate + resolve a session request. Throws SessionPlanError on an
 * invalid cross-axis combination. The trigger source never restricts the
 * tier or mode — only the gate (Mode C) and secret-asset (sandbox) rules
 * do, so user- and server-triggered sessions share identical rules.
 */
export function planSession(
  req: SessionRequest,
  ctx: { thinkAloudGatePassed: boolean },
): SessionPlan {
  // Mode C (autonomous traversal) is gated on human think-aloud data
  // (§11) regardless of who triggered it.
  if (req.mode === 'autonomous' && !ctx.thinkAloudGatePassed) {
    throw new SessionPlanError(
      'mode_c_gated',
      'autonomous (Mode C) sessions require the think-aloud build gate (§11)',
    );
  }

  // A sealed secret asset must never be decrypted on a user device —
  // T1+ sandbox only (§4.5.3 copy-leak boundary).
  if (req.secretAsset && TIER_RANK[req.tier] < TIER_RANK.T1) {
    throw new SessionPlanError(
      'secret_requires_sandbox',
      'secret-asset sessions require a platform sandbox (T1 or T2), not T0',
    );
  }

  const summary =
    `${req.source}-triggered · ${req.mode} · ${req.tier}` +
    (req.secretAsset ? ' · sealed-asset' : '') +
    (req.personaId ? ` · persona ${req.personaId.slice(0, 8)}` : ' · cohort sample');

  return { ...req, summary };
}
