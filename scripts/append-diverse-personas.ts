#!/usr/bin/env npx tsx
/**
 * Append diverse personas (and their backing testers + reports) to the
 * local DB. Idempotent: existing wallets are skipped via ON CONFLICT.
 *
 * Purpose: grow the investor-demo dashboard's N. Seed-data.ts gives us
 * 5 personas; after this script we have ~20, with varied age ranges,
 * crypto backgrounds, device types, and expertise — enough for the
 * convergence and distribution charts to reflect a real population.
 *
 * No LLM calls — reports + vectors are synthesised deterministically
 * from each persona's profile so the dashboard is reproducible.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/append-diverse-personas.ts
 */
import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';

const { Client } = pg;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL required'); process.exit(1); }

// 15 diverse profiles spanning demographics + crypto comfort + device.
// Wallets are synthetic base58-like strings kept stable so re-running
// the script hits ON CONFLICT DO NOTHING.
type Profile = {
  key: string;
  wallet: string;
  displayName: string;
  ageRange: '10s' | '20s' | '30s' | '40s' | '50s' | '60+';
  region: string;
  occupation: string;
  experienceLevel: 'beginner' | 'intermediate' | 'expert';
  cryptoExperience: 'none' | 'beginner' | 'intermediate' | 'advanced';
  primaryDevice: 'mobile' | 'desktop';
  expertise: string[];
  preferredDomains: string[];
  uiPreference: string;
  languages: string[];
  // persona-vector tilt (0..1, used to synthesize the 20-dim vector)
  thoroughness: number;
  uxFocus: number;
  securityAware: number;
  performanceSensitive: number;
  accessibilityFocus: number;
  detailOriented: number;
};

const PROFILES: Profile[] = [
  { key: 'hana',     wallet: '2Hana7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01', displayName: 'Hana Park',    ageRange: '20s', region: 'KR', occupation: 'student',       experienceLevel: 'beginner',     cryptoExperience: 'beginner',    primaryDevice: 'mobile',  expertise: ['general_web'],                 preferredDomains: ['saas'],       uiPreference: 'minimal',      languages: ['ko'],       thoroughness: 0.5, uxFocus: 0.8, securityAware: 0.3, performanceSensitive: 0.6, accessibilityFocus: 0.5, detailOriented: 0.5 },
  { key: 'ivan',     wallet: '2Ivan7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA002', displayName: 'Ivan Petrov',  ageRange: '30s', region: 'RU', occupation: 'developer',     experienceLevel: 'expert',       cryptoExperience: 'advanced',    primaryDevice: 'desktop', expertise: ['defi','gaming'],               preferredDomains: ['defi'],       uiPreference: 'rich',         languages: ['en','ru'],  thoroughness: 0.9, uxFocus: 0.5, securityAware: 0.9, performanceSensitive: 0.7, accessibilityFocus: 0.3, detailOriented: 0.8 },
  { key: 'jade',     wallet: '2Jade7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA003', displayName: 'Jade Li',      ageRange: '20s', region: 'SG', occupation: 'designer',      experienceLevel: 'intermediate', cryptoExperience: 'intermediate',primaryDevice: 'desktop', expertise: ['nft','gaming'],                preferredDomains: ['nft'],        uiPreference: 'playful',      languages: ['en','zh'],  thoroughness: 0.7, uxFocus: 0.95, securityAware: 0.5, performanceSensitive: 0.5, accessibilityFocus: 0.7, detailOriented: 0.9 },
  { key: 'kenji',    wallet: '2Kenji7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA004', displayName: 'Kenji Sato',   ageRange: '40s', region: 'JP', occupation: 'marketer',      experienceLevel: 'intermediate', cryptoExperience: 'beginner',    primaryDevice: 'mobile',  expertise: ['general_web','ai_tools'],      preferredDomains: ['saas'],       uiPreference: 'professional', languages: ['ja'],       thoroughness: 0.6, uxFocus: 0.7, securityAware: 0.5, performanceSensitive: 0.6, accessibilityFocus: 0.5, detailOriented: 0.6 },
  { key: 'lena',     wallet: '2Lena7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA005', displayName: 'Lena Weber',   ageRange: '50s', region: 'DE', occupation: 'product_mgr',   experienceLevel: 'expert',       cryptoExperience: 'none',        primaryDevice: 'desktop', expertise: ['general_web'],                 preferredDomains: ['saas'],       uiPreference: 'minimal',      languages: ['de','en'],  thoroughness: 0.8, uxFocus: 0.9, securityAware: 0.7, performanceSensitive: 0.6, accessibilityFocus: 0.9, detailOriented: 0.85 },
  { key: 'mateo',    wallet: '2Mateo7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA006', displayName: 'Mateo Ruiz',   ageRange: '30s', region: 'MX', occupation: 'trader',        experienceLevel: 'expert',       cryptoExperience: 'advanced',    primaryDevice: 'desktop', expertise: ['defi'],                         preferredDomains: ['defi'],       uiPreference: 'rich',         languages: ['es','en'],  thoroughness: 0.7, uxFocus: 0.4, securityAware: 0.85,performanceSensitive: 0.95,accessibilityFocus: 0.2, detailOriented: 0.75 },
  { key: 'nora',     wallet: '2Nora7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA007', displayName: 'Nora Ahmad',   ageRange: '20s', region: 'AE', occupation: 'engineer',      experienceLevel: 'expert',       cryptoExperience: 'advanced',    primaryDevice: 'mobile',  expertise: ['defi','ai_tools'],             preferredDomains: ['defi'],       uiPreference: 'minimal',      languages: ['ar','en'],  thoroughness: 0.85,uxFocus: 0.7, securityAware: 0.9, performanceSensitive: 0.7, accessibilityFocus: 0.4, detailOriented: 0.8 },
  { key: 'oscar',    wallet: '2Oscar7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA008', displayName: 'Oscar Bramer', ageRange: '60+', region: 'SE', occupation: 'consultant',    experienceLevel: 'intermediate', cryptoExperience: 'none',        primaryDevice: 'desktop', expertise: ['general_web'],                 preferredDomains: ['saas'],       uiPreference: 'professional', languages: ['sv','en'],  thoroughness: 0.75,uxFocus: 0.8, securityAware: 0.6, performanceSensitive: 0.5, accessibilityFocus: 0.95,detailOriented: 0.7 },
  { key: 'priya',    wallet: '2Priya7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA009', displayName: 'Priya Nair',   ageRange: '30s', region: 'IN', occupation: 'founder',       experienceLevel: 'expert',       cryptoExperience: 'intermediate',primaryDevice: 'mobile',  expertise: ['general_web','ai_tools','nft'],preferredDomains: ['saas'],       uiPreference: 'rich',         languages: ['en','hi'],  thoroughness: 0.8, uxFocus: 0.8, securityAware: 0.6, performanceSensitive: 0.8, accessibilityFocus: 0.5, detailOriented: 0.8 },
  { key: 'quinn',    wallet: '2Quinn7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA010', displayName: 'Quinn Mercer', ageRange: '20s', region: 'US', occupation: 'qa_engineer',   experienceLevel: 'expert',       cryptoExperience: 'intermediate',primaryDevice: 'desktop', expertise: ['general_web','defi'],          preferredDomains: ['defi','saas'],uiPreference: 'minimal',      languages: ['en'],       thoroughness: 0.95,uxFocus: 0.7, securityAware: 0.75,performanceSensitive: 0.7, accessibilityFocus: 0.6, detailOriented: 0.95 },
  { key: 'raj',      wallet: '2Raj7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA011', displayName: 'Raj Bhasin',   ageRange: '40s', region: 'IN', occupation: 'banker',        experienceLevel: 'beginner',     cryptoExperience: 'none',        primaryDevice: 'mobile',  expertise: ['general_web'],                 preferredDomains: ['saas'],       uiPreference: 'professional', languages: ['en','hi'],  thoroughness: 0.6, uxFocus: 0.8, securityAware: 0.9, performanceSensitive: 0.4, accessibilityFocus: 0.5, detailOriented: 0.6 },
  { key: 'sara',     wallet: '2Sara7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA012', displayName: 'Sara Dubois',  ageRange: '30s', region: 'FR', occupation: 'journalist',    experienceLevel: 'intermediate', cryptoExperience: 'beginner',    primaryDevice: 'desktop', expertise: ['general_web'],                 preferredDomains: ['saas','nft'], uiPreference: 'rich',         languages: ['fr','en'],  thoroughness: 0.7, uxFocus: 0.85, securityAware: 0.5, performanceSensitive: 0.5, accessibilityFocus: 0.6, detailOriented: 0.7 },
  { key: 'tomas',    wallet: '2Tomas7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA013', displayName: 'Tomas Novak',  ageRange: '20s', region: 'CZ', occupation: 'gamer',         experienceLevel: 'intermediate', cryptoExperience: 'intermediate',primaryDevice: 'desktop', expertise: ['gaming','nft'],                preferredDomains: ['gaming','nft'],uiPreference: 'playful',     languages: ['cs','en'],  thoroughness: 0.5, uxFocus: 0.7, securityAware: 0.4, performanceSensitive: 0.9, accessibilityFocus: 0.3, detailOriented: 0.55 },
  { key: 'ursula',   wallet: '2Ursula7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAA014',displayName: 'Ursula Klein', ageRange: '50s', region: 'AT', occupation: 'accountant',    experienceLevel: 'intermediate', cryptoExperience: 'none',        primaryDevice: 'desktop', expertise: ['general_web'],                 preferredDomains: ['saas'],       uiPreference: 'professional', languages: ['de'],       thoroughness: 0.85,uxFocus: 0.6, securityAware: 0.8, performanceSensitive: 0.5, accessibilityFocus: 0.65,detailOriented: 0.9 },
  { key: 'viktor',   wallet: '2Viktor7v3aAAAAAAAAAAAAAAAAAAAAAAAAAAAAA015',displayName: 'Viktor Novikov',ageRange:'20s', region: 'EE', occupation: 'student',       experienceLevel: 'beginner',     cryptoExperience: 'none',        primaryDevice: 'mobile',  expertise: ['general_web'],                 preferredDomains: ['saas','gaming'],uiPreference: 'minimal',    languages: ['en','et'],  thoroughness: 0.4, uxFocus: 0.6, securityAware: 0.3, performanceSensitive: 0.5, accessibilityFocus: 0.4, detailOriented: 0.4 },
];

function hashSeed(s: string): number {
  const h = createHash('sha256').update(s).digest();
  return (h.readUInt32BE(0) % 10_000) / 10_000; // 0..1
}

function synthVector(p: Profile) {
  const crypto = p.cryptoExperience === 'advanced' ? 0.9 :
    p.cryptoExperience === 'intermediate' ? 0.6 :
    p.cryptoExperience === 'beginner' ? 0.3 : 0.05;
  return {
    test_style: {
      thoroughness: p.thoroughness,
      speed: Math.max(0.2, 1 - p.thoroughness),
      ux_focus: p.uxFocus,
      bug_detection: 0.5 + p.detailOriented * 0.4,
      creativity: 0.3 + hashSeed(p.key + ':creativity') * 0.5,
    },
    expertise: {
      defi: p.expertise.includes('defi') ? 0.8 : crypto * 0.5,
      nft: p.expertise.includes('nft') ? 0.8 : crypto * 0.3,
      gaming: p.expertise.includes('gaming') ? 0.8 : 0.2,
      ai_tools: p.expertise.includes('ai_tools') ? 0.8 : 0.3,
      general_web: 0.7 + hashSeed(p.key + ':gw') * 0.2,
    },
    feedback_pattern: {
      ui_critical: p.uxFocus * 0.9 + 0.1,
      security_aware: p.securityAware,
      performance_sensitive: p.performanceSensitive,
      accessibility_focus: p.accessibilityFocus,
      detail_oriented: p.detailOriented,
    },
    reliability: {
      quality_score: 0.55 + p.thoroughness * 0.4,
      consistency: 0.6 + p.detailOriented * 0.3,
      response_rate: 0.9,
    },
    demographics: {
      age_group: (p.ageRange === '10s' ? 'teen' :
                  p.ageRange === '20s' ? 'young_adult' :
                  p.ageRange === '60+' ? 'senior' : 'adult') as 'teen' | 'young_adult' | 'adult' | 'senior',
      tech_literacy: p.experienceLevel === 'expert' ? 0.9 :
        p.experienceLevel === 'intermediate' ? 0.6 : 0.3,
      crypto_experience: crypto,
      design_sensitivity: p.uxFocus,
      patience_level: 0.5 + hashSeed(p.key + ':patience') * 0.4,
    },
    voice_sample: `${p.displayName} tends to flag ${p.uxFocus > 0.8 ? 'UI inconsistencies' : 'functional issues'} and ${p.securityAware > 0.7 ? 'security concerns' : 'general usability problems'}, often through the lens of ${p.occupation} work.`,
  };
}

function synthReport(p: Profile, checklistIds: string[], qualityBase: number) {
  // Behaviour varies by profile so dashboards see real variance.
  const cl = checklistIds.map((id, i) => {
    const seed = hashSeed(p.key + ':' + id);
    let status: 'passed' | 'failed' | 'blocked' = 'passed';
    if (seed < 0.1 && p.cryptoExperience === 'none') status = 'blocked';
    else if (seed < 0.2 + (1 - p.thoroughness) * 0.15) status = 'failed';
    return {
      id,
      status,
      memo: `Item ${i + 1}: ${status === 'passed'
        ? 'worked as expected'
        : status === 'failed'
          ? `encountered a ${p.uxFocus > 0.7 ? 'UX' : 'functional'} issue`
          : `blocked — ${p.cryptoExperience === 'none' ? 'unfamiliar terminology' : 'upstream dependency failed'}`}.`,
    };
  });
  const q: Array<{ id: string; answer: number | string }> = [
    { id: 'q-1', answer: Math.max(1, Math.min(5, Math.round(qualityBase - 1 + hashSeed(p.key + ':q1') * 2))) },
    { id: 'q-2', answer: Math.max(1, Math.min(10, Math.round(qualityBase * 2 - 2 + hashSeed(p.key + ':q2') * 4))) },
    { id: 'q-3', answer: `As a ${p.occupation} with ${p.cryptoExperience} crypto experience, my biggest concern is ${p.securityAware > 0.7 ? 'transaction security' : p.uxFocus > 0.7 ? 'clarity of flow' : 'response time'}.` },
  ];
  return {
    reportId: randomUUID(),
    checklistResults: cl,
    questionnaireAnswers: q,
    qualityScore: Math.round((qualityBase + (hashSeed(p.key + ':qs') - 0.5) * 0.6) * 10) / 10,
  };
}

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    const { rows: tests } = await db.query<{ id: string; target_url: string }>(
      `SELECT id, target_url FROM tests WHERE status = 'active' ORDER BY created_at LIMIT 10`,
    );
    if (tests.length === 0) {
      console.error('No active tests. Run seed-data.ts first.');
      process.exit(1);
    }
    console.log(`[append] ${tests.length} active tests: ${tests.map((t) => t.target_url).join(', ')}`);

    // Same checklist item ids as seed's DEX/NFT template.
    const CHECKLIST_IDS = ['cl-1', 'cl-2', 'cl-3', 'cl-4'];

    let newTesters = 0;
    let newReports = 0;
    let newPersonas = 0;

    for (const p of PROFILES) {
      // testers
      const ins = await db.query(
        `INSERT INTO testers (wallet_address, display_name, profile, tests_done)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (wallet_address) DO NOTHING
         RETURNING wallet_address`,
        [
          p.wallet,
          p.displayName,
          JSON.stringify({
            age_range: p.ageRange,
            region: p.region,
            occupation: p.occupation,
            expertise: p.expertise,
            experience_level: p.experienceLevel,
            crypto_experience: p.cryptoExperience,
            preferred_domains: p.preferredDomains,
            ui_preference: p.uiPreference,
            languages: p.languages,
            device_types: [p.primaryDevice],
            primary_device: p.primaryDevice,
          }),
          3,
        ],
      );
      if (ins.rowCount && ins.rowCount > 0) newTesters++;

      // reports: one per active test (max 2 with our current seed). The
      // UNIQUE (tester_addr, test_id, is_persona_test) index blocks
      // double-manual so ON CONFLICT DO NOTHING is safe.
      const qualityBase = 2 + p.thoroughness * 2.5; // 2..4.5
      for (const t of tests) {
        const r = synthReport(p, CHECKLIST_IDS, qualityBase);
        const rr = await db.query(
          `INSERT INTO test_reports
             (id, tester_addr, test_id, checklist_results, scenario_log,
              questionnaire_answers, quality_score, is_persona_test)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            r.reportId,
            p.wallet,
            t.id,
            JSON.stringify(r.checklistResults),
            JSON.stringify([]),
            JSON.stringify(r.questionnaireAnswers),
            r.qualityScore,
          ],
        );
        if (rr.rowCount && rr.rowCount > 0) newReports++;
      }

      // persona (one per tester, with stable id from wallet)
      const personaId = randomUUID();
      const vector = synthVector(p);
      const pers = await db.query(
        `INSERT INTO personas (id, tester_addr, vector, is_active, sas_attest_id)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          personaId,
          p.wallet,
          JSON.stringify(vector),
          `sas_demo_${p.key}`,
        ],
      );
      if (pers.rowCount && pers.rowCount > 0) {
        newPersonas++;
        await db.query(
          `UPDATE testers SET persona_id = $1 WHERE wallet_address = $2`,
          [personaId, p.wallet],
        );
      }
    }

    console.log(`[append] inserted: ${newTesters} testers, ${newReports} reports, ${newPersonas} personas`);

    const { rows: totals } = await db.query<{ kind: string; count: string }>(
      `SELECT 'testers' AS kind, COUNT(*)::text FROM testers
       UNION ALL
       SELECT 'personas', COUNT(*)::text FROM personas
       UNION ALL
       SELECT 'reports_manual', COUNT(*)::text FROM test_reports WHERE is_persona_test = false
       UNION ALL
       SELECT 'reports_persona', COUNT(*)::text FROM test_reports WHERE is_persona_test = true`,
    );
    console.log('[append] totals:');
    for (const row of totals) console.log(`  ${row.kind}: ${row.count}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
