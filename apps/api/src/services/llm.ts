import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { GeneratedTestCases, PersonaVector } from '@41rpm/shared';
import { client, withRoute } from './anthropic_client.js';

const SONNET = process.env.CLAUDE_SONNET_MODEL || 'claude-sonnet-4-6';
const HAIKU = process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001';

// ─── Zod Schemas ─────────────────────────────────────
const checklistItemSchema = z.object({
  id: z.string(),
  task: z.string(),
  expected: z.string(),
});

const scenarioItemSchema = z.object({
  id: z.string(),
  persona_type: z.string(),
  narrative: z.string(),
  evaluation_points: z.array(z.string()),
});

const questionnaireItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.enum(['rating_1_5', 'rating_1_10', 'free_text']),
});

const testCasesSchema = z.object({
  checklist: z.array(checklistItemSchema),
  scenarios: z.array(scenarioItemSchema),
  questionnaire: z.array(questionnaireItemSchema),
});

const personaVectorSchema = z.object({
  test_style: z.object({
    thoroughness: z.number().min(0).max(1),
    speed: z.number().min(0).max(1),
    ux_focus: z.number().min(0).max(1),
    bug_detection: z.number().min(0).max(1),
    creativity: z.number().min(0).max(1),
  }),
  expertise: z.object({
    defi: z.number().min(0).max(1),
    nft: z.number().min(0).max(1),
    gaming: z.number().min(0).max(1),
    ai_tools: z.number().min(0).max(1),
    general_web: z.number().min(0).max(1),
  }),
  feedback_pattern: z.object({
    ui_critical: z.number().min(0).max(1),
    security_aware: z.number().min(0).max(1),
    performance_sensitive: z.number().min(0).max(1),
    accessibility_focus: z.number().min(0).max(1),
    detail_oriented: z.number().min(0).max(1),
  }),
  reliability: z.object({
    quality_score: z.number().min(0).max(5),
    consistency: z.number().min(0).max(1),
    response_rate: z.number().min(0).max(1),
  }),
  demographics: z.object({
    age_group: z.enum(['teen', 'young_adult', 'adult', 'senior']),
    tech_literacy: z.number().min(0).max(1),
    crypto_experience: z.number().min(0).max(1),
    design_sensitivity: z.number().min(0).max(1),
    patience_level: z.number().min(0).max(1),
  }).optional(),
  ux_preferences: z.object({
    visual_style: z.enum(['minimal', 'rich', 'playful', 'professional']),
    font_size_preference: z.number().min(0).max(1),
    information_density: z.number().min(0).max(1),
    animation_tolerance: z.number().min(0).max(1),
    color_contrast_need: z.number().min(0).max(1),
    mobile_first: z.boolean(),
  }).optional(),
  voice_sample: z.string(),
});

// ─── Helper: extract JSON from LLM response ─────────
export function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];
  return text;
}

// ─── Helper: repair truncated/malformed JSON ─────────
function repairJson(text: string): string {
  let json = text;
  // Remove trailing commas before ] or }
  json = json.replace(/,\s*([\]}])/g, '$1');
  // Try to fix truncated JSON by closing open brackets
  let openBraces = 0, openBrackets = 0;
  let inString = false, escape = false;
  for (const ch of json) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }
  // Close any unclosed structures
  for (let i = 0; i < openBrackets; i++) json += ']';
  for (let i = 0; i < openBraces; i++) json += '}';
  return json;
}

function parseJsonSafe(text: string): any {
  const raw = extractJson(text);
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('[LLM] JSON parse failed, attempting repair...');
    const repaired = repairJson(raw);
    return JSON.parse(repaired);
  }
}

// ─── Generate Test Cases ─────────────────────────────
export async function generateTestCases(
  targetUrl: string,
  requirements: string,
  screenshotBase64?: string,
): Promise<GeneratedTestCases> {
  const content: Anthropic.ContentBlockParam[] = [];

  if (screenshotBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 },
    });
  }

  const hasCustomRequirements = requirements && requirements.trim().length > 0;

  content.push({
    type: 'text',
    text: `You are a senior QA architect creating a comprehensive test plan for a product.

Target URL: ${targetUrl}
${hasCustomRequirements ? `
## ⚠️ CLIENT REQUIREMENTS (HIGHEST PRIORITY)
The client has specified the following testing focus areas. These MUST be the primary driver of your test plan.
At least 40-50% of all checklist items MUST directly address these requirements:

"${requirements}"

Analyze these requirements carefully and generate test cases that specifically target each concern mentioned.
For example:
- If security is mentioned → include items for XSS, CSRF, token approval checks, input sanitization, CSP headers, etc.
- If numerical accuracy / math is mentioned → include items for price calculation verification, rounding errors, slippage math, fee computation, etc.
- If DeFi is mentioned → include items for liquidity pool math, impermanent loss display, APY calculations, oracle price accuracy, etc.
- Map every keyword in the requirements to concrete, testable checklist items.
` : `Requirements: General UX/functionality testing`}

Generate a thorough, detailed JSON test plan with this structure:
{
  "checklist": [{ "id": "CL01", "task": "...", "expected": "..." }, ...],
  "scenarios": [{ "id": "SC01", "persona_type": "...", "narrative": "...", "evaluation_points": [...] }],
  "questionnaire": [{ "id": "Q01", "question": "...", "type": "rating_1_5"|"rating_1_10"|"free_text" }, ...]
}

## Checklist (8-12 items required)
${hasCustomRequirements ? `**FIRST**: Generate 4-6 items directly from the client requirements above.
**THEN**: Fill remaining slots from these general categories:` : `Cover ALL of these categories:`}
- **Core functionality**: Main user flows, primary CTAs, key features (2-3 items)
- **Navigation & Layout**: Menu links, breadcrumbs, responsive behavior, header/footer (1-2 items)
- **Forms & Input**: Validation, error messages, edge cases (empty, too long, special chars) (1-2 items)
- **Visual & UX**: Loading states, animations, color contrast, typography, spacing (1 item)
- **Error handling**: 404 pages, network failures, invalid URLs, session expiry (1 item)
- **Performance**: Page load speed, image optimization, lazy loading (1 item)
- **Wallet/Web3** (if applicable): Connection flow, network switching, transaction states (1-2 items)
Each task must be specific and actionable (not vague like "test the page").
${hasCustomRequirements ? `\n**IMPORTANT**: The first 4-6 checklist items (CL01-CL06) MUST be derived from the client requirements. Do NOT generate generic items for these slots.` : ''}

## Scenarios (3-4 required)
Create distinct user personas with different goals:
${hasCustomRequirements ? `- At least 1 scenario MUST be a specialist who focuses on the client's requirement areas (e.g., security auditor, DeFi analyst, etc.)
- The remaining scenarios should cover:` : `- A first-time visitor (confused, needs guidance)`}
- A power user (knows what they want, tests edge cases)
- A skeptical user (looking for trust signals, checks security)
- A mobile user (testing on small screen) — if applicable
Each scenario should have 3-5 evaluation points.

## Questionnaire (6-8 items required)
Mix of rating and free-text:
- 2-3 rating_1_5 questions (overall satisfaction, visual design, ease of use)
- 1-2 rating_1_10 questions (NPS-style: would you recommend? overall impression?)
- 2-3 free_text questions (biggest pain point, most confusing part, suggestions for improvement, what worked well)
${hasCustomRequirements ? `- At least 1-2 questions MUST specifically address the client requirements (e.g., "How confident are you in the security of this product?" or "Did you notice any numerical inconsistencies?")` : ''}

Return ONLY the JSON, wrapped in \`\`\`json code block.`,
  });

  const response = await withRoute('test_cases', () => client.messages.create({
    model: SONNET,
    max_tokens: 8192,
    messages: [{ role: 'user', content }],
  }));

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = parseJsonSafe(text);

  // Fill in missing sections from truncated responses
  if (!parsed.checklist) parsed.checklist = [];
  if (!parsed.scenarios) parsed.scenarios = [];
  if (!parsed.questionnaire) parsed.questionnaire = [];

  // Log stop reason for debugging
  if (response.stop_reason === 'max_tokens') {
    console.warn(`[LLM] Response was truncated (max_tokens hit). Checklist: ${parsed.checklist.length}, Scenarios: ${parsed.scenarios.length}, Questionnaire: ${parsed.questionnaire.length}`);
  }

  return testCasesSchema.parse(parsed);
}

// ─── Generate Persona Vector ─────────────────────────
export async function generatePersona(
  profile: Record<string, unknown>,
  reports: Record<string, unknown>[],
): Promise<PersonaVector> {
  // Map profile demographics to help LLM generate accurate persona
  const ageRangeToGroup: Record<string, string> = {
    '10s': 'teen', '20s': 'young_adult', '30s': 'young_adult',
    '40s': 'adult', '50s': 'adult', '60+': 'senior',
  };
  const cryptoExpToScore: Record<string, string> = {
    'none': '0.0-0.1', 'beginner': '0.1-0.3', 'intermediate': '0.4-0.6', 'advanced': '0.7-1.0',
  };

  let demographicHints = '';
  if (profile.age_range) {
    demographicHints += `\n- Tester age range: ${profile.age_range} → map to age_group "${ageRangeToGroup[profile.age_range as string] || 'adult'}"`;
  }
  if (profile.region) demographicHints += `\n- Region: ${profile.region}`;
  if (profile.occupation) demographicHints += `\n- Occupation: ${profile.occupation}`;
  if (profile.crypto_experience) {
    demographicHints += `\n- Crypto experience: ${profile.crypto_experience} → crypto_experience score should be in range ${cryptoExpToScore[profile.crypto_experience as string] || '0.5'}`;
  }
  if (profile.primary_device) demographicHints += `\n- Primary device: ${profile.primary_device} → mobile_first=${profile.primary_device === 'mobile'}`;
  if (profile.design_matters !== undefined) {
    demographicHints += `\n- Design matters to them: ${profile.design_matters} → design_sensitivity should be ${profile.design_matters ? '0.7-1.0' : '0.2-0.5'}`;
  }
  if (Array.isArray(profile.frustration_triggers) && (profile.frustration_triggers as string[]).length > 0) {
    demographicHints += `\n- Frustration triggers: ${(profile.frustration_triggers as string[]).join(', ')} → reflect these in feedback_pattern and ux_preferences`;
  }

  const prompt = `You are a persona analysis expert. Analyze this tester's profile and their 3 test reports to create a Persona Vector.

[Profile] ${JSON.stringify(profile)}
[Report 1] ${JSON.stringify(reports[0])}
[Report 2] ${JSON.stringify(reports[1])}
[Report 3] ${JSON.stringify(reports[2])}
${demographicHints ? `\n[Demographic Mapping Hints]${demographicHints}` : ''}

Generate a JSON object with this structure:
{
  "test_style": { "thoroughness": 0.0-1.0, "speed": 0.0-1.0, "ux_focus": 0.0-1.0, "bug_detection": 0.0-1.0, "creativity": 0.0-1.0 },
  "expertise": { "defi": 0.0-1.0, "nft": 0.0-1.0, "gaming": 0.0-1.0, "ai_tools": 0.0-1.0, "general_web": 0.0-1.0 },
  "feedback_pattern": { "ui_critical": 0.0-1.0, "security_aware": 0.0-1.0, "performance_sensitive": 0.0-1.0, "accessibility_focus": 0.0-1.0, "detail_oriented": 0.0-1.0 },
  "reliability": { "quality_score": 0.0-5.0, "consistency": 0.0-1.0, "response_rate": 0.0-1.0 },
  NOTE: quality_score uses 0.0-5.0 scale (average quality of their test reports). All other numeric values use 0.0-1.0 scale.
  "demographics": {
    "age_group": "teen"|"young_adult"|"adult"|"senior",
    "tech_literacy": 0.0-1.0,
    "crypto_experience": 0.0-1.0,
    "design_sensitivity": 0.0-1.0,
    "patience_level": 0.0-1.0
  },
  "ux_preferences": {
    "visual_style": "minimal"|"rich"|"playful"|"professional",
    "font_size_preference": 0.0-1.0,
    "information_density": 0.0-1.0,
    "animation_tolerance": 0.0-1.0,
    "color_contrast_need": 0.0-1.0,
    "mobile_first": true|false
  },
  "voice_sample": "2-3 sentence description of this tester's characteristic feedback style, reflecting their age group and design preferences"
}

IMPORTANT: Use the profile's demographic data (age_range, region, occupation, crypto_experience, primary_device, design_matters, frustration_triggers) to set demographics and ux_preferences accurately. Also cross-reference with report writing style.

Return ONLY the JSON, wrapped in \`\`\`json code block.`;

  const response = await withRoute('persona_vector', () => client.messages.create({
    model: SONNET,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  }));

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = parseJsonSafe(text);
  return personaVectorSchema.parse(parsed);
}

// ─── Generate Auto Test Report ───────────────────────
export interface AutoTestReportResult {
  textReport: string;
  uxFeedback: Record<string, unknown>;
  checklistResults: Array<{ id: string; status: 'passed' | 'failed' | 'blocked'; memo: string }>;
  questionnaireAnswers: Array<{ id: string; answer: string | number }>;
  qualityScore: number;
}

export async function generateAutoTestReport(
  persona: PersonaVector,
  screenshotsBase64: string[],
  actionLog: string[],
  testCases: GeneratedTestCases,
): Promise<AutoTestReportResult> {
  const content: Anthropic.ContentBlockParam[] = [];

  for (const ss of screenshotsBase64.slice(0, 5)) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: ss },
    });
  }

  // Build persona focus description for differentiated analysis
  const focusAreas: string[] = [];
  if (persona.feedback_pattern.security_aware > 0.6) focusAreas.push('security vulnerabilities, unsafe inputs, token approvals');
  if (persona.feedback_pattern.ui_critical > 0.6) focusAreas.push('visual design flaws, layout issues, color contrast');
  if (persona.feedback_pattern.performance_sensitive > 0.6) focusAreas.push('loading speed, animation jank, resource usage');
  if (persona.feedback_pattern.accessibility_focus > 0.6) focusAreas.push('accessibility gaps, keyboard nav, screen reader support');
  if (persona.feedback_pattern.detail_oriented > 0.6) focusAreas.push('subtle bugs, edge cases, inconsistencies');
  if (persona.expertise.defi > 0.6) focusAreas.push('DeFi mechanics, slippage, fee transparency');
  if (persona.expertise.nft > 0.6) focusAreas.push('NFT display, metadata, ownership');
  if (focusAreas.length === 0) focusAreas.push('general usability and user experience');

  // Build a rich persona identity description
  const demo = persona.demographics;
  const ux = persona.ux_preferences;
  let personaIdentity = '';
  if (demo) {
    const ageLabels: Record<string, string> = { teen: 'teenager (16-19)', young_adult: 'young adult (20-30s)', adult: 'middle-aged adult (30-50s)', senior: 'senior (50+)' };
    personaIdentity += `\nYou are a ${ageLabels[demo.age_group] || demo.age_group}.`;
    if (demo.tech_literacy < 0.3) personaIdentity += ' You struggle with technical jargon and get confused easily.';
    else if (demo.tech_literacy > 0.8) personaIdentity += ' You are highly technical and notice implementation details others miss.';
    if (demo.patience_level < 0.3) personaIdentity += ' You are VERY impatient — if something takes more than 2 clicks or 3 seconds, you get frustrated.';
    if (demo.design_sensitivity > 0.7) personaIdentity += ' You have a strong eye for design and immediately notice visual inconsistencies.';
    if (demo.crypto_experience < 0.3) personaIdentity += ' Crypto is confusing to you — you need clear explanations for blockchain terms.';
    else if (demo.crypto_experience > 0.8) personaIdentity += ' You are a crypto native who checks token contracts, understands MEV, and scrutinizes on-chain interactions.';
  }
  if (ux) {
    if (ux.mobile_first) personaIdentity += ' You primarily use mobile and test everything from a phone perspective.';
    personaIdentity += ` You prefer ${ux.visual_style} design style.`;
  }

  content.push({
    type: 'text',
    text: `You are a real QA tester with a STRONG personality. Stay in character throughout.

## Your Persona Profile
${JSON.stringify(persona, null, 2)}

## Your Identity
Voice style: "${persona.voice_sample}"
${personaIdentity}

## Your Testing Focus (what you care about MOST)
${focusAreas.map((f, i) => `${i + 1}. ${f}`).join('\n')}

## Actions You Performed
${actionLog.map((a, i) => `${i + 1}. ${a}`).join('\n')}

## Test Cases
${JSON.stringify(testCases, null, 2)}

---

Write a DETAILED, opinionated test report from YOUR unique perspective. You must stay in character — your personality, expertise, and biases should be clearly visible in every field.

Return as JSON:
\`\`\`json
{
  "textReport": "3-4 paragraphs. Write as if YOU are the tester talking to the product team. Reference specific UI elements, button labels, colors, flows. Mention what frustrated you and what delighted you. Your tone should match your voice_sample. A security-focused tester talks about vulnerabilities; a design-focused tester talks about spacing and typography; a DeFi expert talks about slippage and fee transparency. Be SPECIFIC — no generic feedback.",
  "qualityScore": 1.0-5.0,
  "checklistResults": [
    { "id": "CL01", "status": "passed|failed|blocked", "memo": "2-3 sentences. What did you observe? How does it affect the user experience from YOUR perspective? What would you do differently?" },
    ...for EVERY checklist item
  ],
  "questionnaireAnswers": [
    { "id": "Q01", "answer": <number for ratings, 2-3 sentence string for free_text> },
    ...for EVERY questionnaire item — free_text answers must be substantive (min 20 words), reflecting your persona's specific concerns
  ],
  "uxFeedback": {
    "overall_score": 1-5,
    "usability": 1-5,
    "visual_design": 1-5,
    "performance": 1-5,
    "accessibility": 1-5,
    "trust_and_security": 1-5,
    "issues_found": ["specific issue with exact location/element", "another specific issue", ...at least 3],
    "positive_aspects": ["something that worked well", ...at least 2],
    "suggestions": ["actionable improvement suggestion", ...at least 3],
    "persona_specific_notes": "What did YOU specifically notice that other testers might miss? 2-3 sentences."
  }
}
\`\`\`

CRITICAL RULES:
- checklistResults: Map action results (OK → passed, Failed/Error → failed, not attempted → blocked). Each memo MUST reflect YOUR persona's viewpoint — same checklist item should get DIFFERENT memos from different personas.
- questionnaireAnswers: Match ALL IDs from test_cases.questionnaire. Ratings should vary based on your expertise (security expert rates security higher/lower than design expert).
- qualityScore: YOUR subjective rating. A performance-sensitive tester may give 2.5 if the site is slow but pretty. A design-sensitive tester may give 2.5 if the site is fast but ugly.
- issues_found: Be SPECIFIC — "The swap button at the bottom of the trade form has no loading state" NOT "UI could be improved".
- NEVER write generic feedback like "the site works well" or "overall good experience". Be detailed and opinionated.`,
  });

  const response = await withRoute('autotest_report', () => client.messages.create({
    model: SONNET,
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  }));

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = parseJsonSafe(text);

  // Validate and normalize
  return {
    textReport: String(parsed.textReport || ''),
    qualityScore: Math.min(5, Math.max(1, Number(parsed.qualityScore) || 3)),
    checklistResults: Array.isArray(parsed.checklistResults)
      ? parsed.checklistResults.map((c: Record<string, unknown>) => ({
          id: String(c.id || ''),
          status: (['passed', 'failed', 'blocked'].includes(String(c.status)) ? c.status : 'blocked') as 'passed' | 'failed' | 'blocked',
          memo: String(c.memo || ''),
        }))
      : [],
    questionnaireAnswers: Array.isArray(parsed.questionnaireAnswers)
      ? parsed.questionnaireAnswers.map((q: Record<string, unknown>) => ({
          id: String(q.id || ''),
          answer: typeof q.answer === 'number' ? q.answer : String(q.answer || ''),
        }))
      : [],
    uxFeedback: parsed.uxFeedback || { overall_score: 3 },
  };
}

// ─── Quality Score + Reward (Haiku - fast) ────────────────────

export interface QualityResult {
  score: number;        // 0.0 ~ 5.0
  rewardUsdc: number;   // 0 or $1 ~ $5
  reason: string;       // 1-line explanation
  rejected: boolean;    // true = no payment
}

export class QualityScoreTimeout extends Error {
  constructor(public readonly elapsedMs: number) {
    super(`LLM quality scoring timed out after ${elapsedMs}ms`);
    this.name = 'QualityScoreTimeout';
  }
}

const QUALITY_SCORE_TIMEOUT_MS = Number(process.env.QUALITY_SCORE_TIMEOUT_MS ?? 30_000);

export async function calculateQualityScore(
  report: Record<string, unknown>,
): Promise<QualityResult> {
  const started = Date.now();
  const response = await withRoute('quality_judge', () => client.messages.create({
    model: HAIKU,
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `You are a test report quality judge. Score the report quality from 0.0 to 5.0.
The actual dollar reward is calculated separately using a power curve — your job is ONLY to assign an accurate quality score.

## Scoring Rules (be strict — differentiate clearly)
- **0.0 ~ 1.4 → REJECTED**: Empty fields, single-word answers, no real testing done, copy-paste nonsense, all checkboxes clicked with no notes
- **1.5 ~ 2.4 → Below Average**: Very brief, minimal effort, few details, generic observations
- **2.5 ~ 3.4 → Average**: Decent coverage but lacking depth, some useful observations
- **3.5 ~ 4.4 → Good**: Thorough testing, detailed notes per checklist item, helpful feedback with specifics
- **4.5 ~ 5.0 → Exceptional**: Found real bugs, actionable insights, detailed journey logs, expert-level observations

## Score Anchors (use these to calibrate)
- A report where every checklist item just says "ok" or "pass" = 1.5~2.0
- A report with 1-sentence notes per item, brief scenarios = 2.5~3.0
- A report with detailed notes, specific bugs found, thorough scenarios = 3.5~4.0
- A report with screenshots evidence, edge-case testing, root cause analysis = 4.5~5.0

## What gets REJECTED (score < 1.5):
- All checklist items left as "blocked" with no notes
- Scenario logs with fewer than 10 words total
- Questionnaire answers that are all empty or single-word
- Obvious spam or placeholder text

Report data:
${JSON.stringify(report)}

Return ONLY valid JSON:
{"score": 3.5, "reason": "brief explanation", "rejected": false}`,
    }],
  }, {
    // AbortSignal → SDK cancels the request and throws APIUserAbortError.
    // We re-raise as QualityScoreTimeout so report.ts can distinguish
    // transient timeouts (retryable) from truly malformed responses.
    signal: AbortSignal.timeout(QUALITY_SCORE_TIMEOUT_MS),
  }).catch((err: unknown) => {
    const elapsed = Date.now() - started;
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || name === 'APIUserAbortError' || name === 'TimeoutError') {
      throw new QualityScoreTimeout(elapsed);
    }
    throw err;
  }));

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const parsed = parseJsonSafe(text);
    const rawScore = Number(parsed.score);
    if (!Number.isFinite(rawScore)) {
      throw new Error('LLM returned non-numeric score');
    }
    const score = Math.min(5, Math.max(0, rawScore));
    const rejected = score < 1.5 || parsed.rejected === true;
    return {
      score,
      rewardUsdc: 0, // Calculated by report.ts using power curve
      reason: String(parsed.reason || ''),
      rejected,
    };
  } catch {
    // Malformed response (not a timeout) → fall back to rule-based
    // heuristic. The heuristic inspects the actual report content, so
    // it's safe to keep as a deterministic fallback. A blanket score=2.0
    // default used to live here; it was removed because it silently paid
    // spam submissions ~25% of the reward.
    return heuristicQualityScore(report);
  }
}

function heuristicQualityScore(report: Record<string, unknown>): QualityResult {
  let score = 0;
  const checklist = report.checklist_results as Array<{ status: string; memo: string }> | undefined;
  const scenarios = report.scenario_log as Array<{ timeline: Array<{ action: string }> }> | undefined;
  const answers = report.questionnaire_answers as Array<{ answer: string | number }> | undefined;

  // Checklist: max 2 points
  if (checklist && checklist.length > 0) {
    const withNotes = checklist.filter(c => c.memo && c.memo.length > 5).length;
    const completed = checklist.filter(c => c.status === 'passed' || c.status === 'failed').length;
    score += (completed / checklist.length) * 1.0;
    score += (withNotes / checklist.length) * 1.0;
  }

  // Scenarios: max 1.5 points
  if (scenarios && scenarios.length > 0) {
    const totalWords = scenarios.reduce((sum, s) => {
      const words = s.timeline?.reduce((w, t) => w + (t.action?.split(' ').length || 0), 0) || 0;
      return sum + words;
    }, 0);
    score += Math.min(1.5, totalWords / 40);
  }

  // Questionnaire: max 1.5 points
  if (answers && answers.length > 0) {
    const meaningful = answers.filter(a => {
      const val = String(a.answer || '');
      return val.length > 3 && val !== '[object Object]';
    }).length;
    score += (meaningful / answers.length) * 1.5;
  }

  score = Math.round(score * 10) / 10;
  const rejected = score < 1.5;
  let rewardUsdc = 0;
  if (!rejected) {
    if (score < 2.5) rewardUsdc = 1;
    else if (score < 3.5) rewardUsdc = Math.round((2 + (score - 2.5)) * 10) / 10;
    else if (score < 4.5) rewardUsdc = 4;
    else rewardUsdc = 5;
  }

  return {
    score,
    rewardUsdc,
    reason: rejected ? 'Report lacks sufficient detail or effort' : `Heuristic score based on completeness`,
    rejected,
  };
}

// ─── Keyword Extraction (Haiku - fast) ───────────────
export async function extractKeywords(text: string): Promise<string[]> {
  const response = await withRoute('keywords', () => client.messages.create({
    model: HAIKU,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Extract 5-10 testing-relevant keywords from this text. Return as JSON array of strings.
Text: ${text}
Return ONLY: ["keyword1", "keyword2", ...]`,
    }],
  }));

  const respText = response.content[0].type === 'text' ? response.content[0].text : '[]';
  return parseJsonSafe(respText);
}

// ─── Generate Persona-Specific Browser Actions (Haiku - fast) ────
export async function generatePersonaActions(
  persona: PersonaVector,
  targetUrl: string,
  baseChecklist: Array<{ id: string; task: string }>,
  discoveredLinks: string[] = [],
  navLabels: string[] = [],
): Promise<Array<{ id: string; action: string; reason: string }>> {
  // Build a focus summary from the persona's top traits
  const focusAreas: string[] = [];

  // Technical focus areas
  if (persona.feedback_pattern.security_aware > 0.7) focusAreas.push('security (check HTTPS, token approvals, suspicious scripts, error handling on invalid input)');
  if (persona.feedback_pattern.performance_sensitive > 0.7) focusAreas.push('performance (loading speed, animation smoothness, lazy-load behavior)');
  if (persona.feedback_pattern.ui_critical > 0.7) focusAreas.push('UI quality (visual glitches, alignment, color contrast, responsive layout)');
  if (persona.feedback_pattern.accessibility_focus > 0.7) focusAreas.push('accessibility (screen reader labels, keyboard navigation, font sizes)');
  if (persona.expertise.defi > 0.7) focusAreas.push('DeFi specifics (slippage controls, price impact display, fee breakdown, MEV protection, route transparency)');
  if (persona.expertise.nft > 0.7) focusAreas.push('NFT specifics (image loading, metadata display, ownership verification)');
  if (persona.expertise.gaming > 0.7) focusAreas.push('gaming specifics (frame rate, input latency, tutorial flow)');
  if (persona.test_style.thoroughness > 0.8) focusAreas.push('edge cases (empty states, error recovery, boundary values)');

  // Demographics-driven focus areas
  const demo = persona.demographics;
  if (demo) {
    if (demo.age_group === 'teen') focusAreas.push('teen UX (is the language relatable? are visuals engaging? is onboarding too boring or too long? would a 16-year-old understand this without help?)');
    if (demo.age_group === 'senior') focusAreas.push('senior UX (font readability at default size, button sizes adequate for less precise clicks, clear navigation without hidden menus, no reliance on hover states)');
    if (demo.tech_literacy < 0.3) focusAreas.push('non-technical user (confusing jargon, unclear icons, missing explanations for crypto terms, fear-inducing warnings)');
    if (demo.design_sensitivity > 0.7) focusAreas.push('design quality (visual hierarchy, whitespace balance, typography consistency, color harmony, micro-interactions, brand feeling)');
    if (demo.patience_level < 0.3) focusAreas.push('impatient user (how many clicks to complete core task? any unnecessary steps? loading states that feel too long?)');
  }

  // UX preferences-driven focus areas
  const ux = persona.ux_preferences;
  if (ux) {
    if (ux.mobile_first) focusAreas.push('mobile-first (test at 375px width, check thumb-reachable zones, verify no horizontal scroll, ensure tap targets are 44px+)');
    if (ux.font_size_preference > 0.7) focusAreas.push('readability (check if body text is at least 16px, labels are clear, numbers in data-heavy sections are legible)');
    if (ux.color_contrast_need > 0.7) focusAreas.push('contrast (check text-on-background contrast ratios, especially on dark themes, verify critical buttons are distinguishable)');
    if (ux.information_density < 0.3) focusAreas.push('simplicity (is the UI overwhelming? too many numbers/charts on screen? are essential actions buried under data?)');
    if (ux.animation_tolerance < 0.3) focusAreas.push('animation sensitivity (check for distracting or excessive animations, auto-playing elements, flashing content)');
  }

  if (focusAreas.length === 0) focusAreas.push('general usability and UX flow');

  // Build persona context string
  let personaContext = '';
  if (demo) {
    const ageLabel = { teen: '10대 청소년', young_adult: '20-30대', adult: '30-50대', senior: '50대 이상' }[demo.age_group];
    personaContext += `\nThis tester is a ${ageLabel} user with tech literacy ${demo.tech_literacy.toFixed(1)}/1.0 and crypto experience ${demo.crypto_experience.toFixed(1)}/1.0.`;
    if (demo.design_sensitivity > 0.7) personaContext += ' They care deeply about visual design quality.';
    if (demo.patience_level < 0.4) personaContext += ' They have LOW patience — will abandon if confused.';
  }
  if (ux) {
    personaContext += `\nPrefers ${ux.visual_style} design style.`;
    if (ux.mobile_first) personaContext += ' Primarily uses mobile.';
  }

  // Build site context for navigation-aware actions
  let siteContext = '';
  if (discoveredLinks.length > 0) {
    siteContext += `\n\nDiscovered pages on this site:\n${discoveredLinks.map(l => `- ${l}`).join('\n')}`;
  }
  if (navLabels.length > 0) {
    siteContext += `\n\nNavigation menu items found: ${navLabels.join(', ')}`;
  }

  const prompt = `You are generating browser test actions for a QA tester with these focus areas:
${focusAreas.map((f, i) => `${i + 1}. ${f}`).join('\n')}
${personaContext}

Target URL: ${targetUrl}
${siteContext}

The tester already performed these base checklist actions:
${baseChecklist.map(c => `- ${c.id}: ${c.task}`).join('\n')}

Generate 5-8 ADDITIONAL browser actions this persona would specifically do. CRITICAL RULES:
1. **At least 2-3 actions MUST navigate to DIFFERENT pages** — click nav items, visit discovered links, explore sections the checklist didn't cover
2. **Vary the interaction types**: click buttons, open modals/dropdowns, scroll to specific sections, try form inputs, toggle dark/light mode, resize viewport, check mobile menu
3. Actions must be concrete and executable by a browser automation tool (click, scroll, type, navigate)
4. Each action should result in a visually DIFFERENT screen state from the others
5. Do NOT repeat actions already in the checklist

Return as JSON array:
\`\`\`json
[
  { "id": "PA01", "action": "Click the navigation link to go to the Settings or Profile page", "reason": "Explore pages beyond the landing page" },
  { "id": "PA02", "action": "Scroll to the footer section and check all footer links", "reason": "Verify site-wide navigation and legal links" },
  { "id": "PA03", "action": "Click the hamburger menu or mobile nav toggle if visible", "reason": "Test responsive navigation behavior" },
  ...
]
\`\`\``;

  const response = await withRoute('persona_actions', () => client.messages.create({
    model: HAIKU,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  }));

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  try {
    const parsed = parseJsonSafe(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[generatePersonaActions] Failed to parse LLM response:', text.slice(0, 300), err);
    return [];
  }
}
