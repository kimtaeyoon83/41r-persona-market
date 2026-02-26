import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { GeneratedTestCases, PersonaVector } from '@41rpm/shared';

const client = new Anthropic();

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
    quality_score: z.number().min(0).max(1),
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
function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];
  return text;
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

  content.push({
    type: 'text',
    text: `You are a QA expert. Analyze this website and generate test cases.

Target URL: ${targetUrl}
Requirements: ${requirements || 'General UX/functionality testing'}

Generate a JSON object with exactly this structure:
{
  "checklist": [{ "id": "CL01", "task": "...", "expected": "..." }, ...],
  "scenarios": [{ "id": "SC01", "persona_type": "...", "narrative": "...", "evaluation_points": [...] }],
  "questionnaire": [{ "id": "Q01", "question": "...", "type": "rating_1_5"|"rating_1_10"|"free_text" }, ...]
}

Generate 4-6 checklist items, 1-2 scenarios, and 4-6 questionnaire items.
Return ONLY the JSON, wrapped in \`\`\`json code block.`,
  });

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 2000,
    messages: [{ role: 'user', content }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = JSON.parse(extractJson(text));
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

Generate a JSON object with this structure (all numeric values 0.0-1.0):
{
  "test_style": { "thoroughness": 0.0-1.0, "speed": 0.0-1.0, "ux_focus": 0.0-1.0, "bug_detection": 0.0-1.0, "creativity": 0.0-1.0 },
  "expertise": { "defi": 0.0-1.0, "nft": 0.0-1.0, "gaming": 0.0-1.0, "ai_tools": 0.0-1.0, "general_web": 0.0-1.0 },
  "feedback_pattern": { "ui_critical": 0.0-1.0, "security_aware": 0.0-1.0, "performance_sensitive": 0.0-1.0, "accessibility_focus": 0.0-1.0, "detail_oriented": 0.0-1.0 },
  "reliability": { "quality_score": 0.0-1.0, "consistency": 0.0-1.0, "response_rate": 0.0-1.0 },
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

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = JSON.parse(extractJson(text));
  return personaVectorSchema.parse(parsed);
}

// ─── Generate Auto Test Report ───────────────────────
export async function generateAutoTestReport(
  persona: PersonaVector,
  screenshotsBase64: string[],
  actionLog: string[],
  testCases: GeneratedTestCases,
): Promise<{ textReport: string; uxFeedback: Record<string, unknown> }> {
  const content: Anthropic.ContentBlockParam[] = [];

  for (const ss of screenshotsBase64.slice(0, 5)) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: ss },
    });
  }

  content.push({
    type: 'text',
    text: `You are a tester with this Persona:
${JSON.stringify(persona, null, 2)}

Voice style: "${persona.voice_sample}"

You visited a website and performed the following actions:
${actionLog.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Test cases were:
${JSON.stringify(testCases, null, 2)}

Write a test report from this Persona's perspective. Include:
1. A text report (2-3 paragraphs) reflecting the Persona's style/focus
2. UX feedback JSON with ratings and comments

Return as JSON:
\`\`\`json
{
  "textReport": "...",
  "uxFeedback": {
    "overall_score": 1-5,
    "usability": 1-5,
    "visual_design": 1-5,
    "performance": 1-5,
    "issues_found": ["..."],
    "suggestions": ["..."]
  }
}
\`\`\``,
  });

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 2000,
    messages: [{ role: 'user', content }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return JSON.parse(extractJson(text));
}

// ─── Quality Score (Haiku - fast) ────────────────────
export async function calculateQualityScore(
  report: Record<string, unknown>,
): Promise<number> {
  const response = await client.messages.create({
    model: HAIKU,
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `Rate this test report's quality from 1.0 to 5.0 based on completeness, detail, and usefulness.
Report: ${JSON.stringify(report)}
Return ONLY a single number like 3.8`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '3.0';
  const score = parseFloat(text.trim());
  return Math.min(5, Math.max(1, isNaN(score) ? 3.0 : score));
}

// ─── Keyword Extraction (Haiku - fast) ───────────────
export async function extractKeywords(text: string): Promise<string[]> {
  const response = await client.messages.create({
    model: HAIKU,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Extract 5-10 testing-relevant keywords from this text. Return as JSON array of strings.
Text: ${text}
Return ONLY: ["keyword1", "keyword2", ...]`,
    }],
  });

  const respText = response.content[0].type === 'text' ? response.content[0].text : '[]';
  return JSON.parse(extractJson(respText));
}

// ─── Generate Persona-Specific Browser Actions (Haiku - fast) ────
export async function generatePersonaActions(
  persona: PersonaVector,
  targetUrl: string,
  baseChecklist: Array<{ id: string; task: string }>,
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

  const prompt = `You are generating browser test actions for a QA tester with these focus areas:
${focusAreas.map((f, i) => `${i + 1}. ${f}`).join('\n')}
${personaContext}

Target URL: ${targetUrl}

The tester already performed these base checklist actions:
${baseChecklist.map(c => `- ${c.id}: ${c.task}`).join('\n')}

Generate 3-5 ADDITIONAL browser actions this persona would specifically do based on their focus areas and demographics. These must be concrete, executable browser actions (click, scroll, type, observe) — NOT abstract analysis.

Return as JSON array:
\`\`\`json
[
  { "id": "PA01", "action": "Scroll down to check if fee breakdown is visible without wallet connection", "reason": "DeFi expert checks pre-trade transparency" },
  ...
]
\`\`\``;

  const response = await client.messages.create({
    model: HAIKU,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  try {
    const parsed = JSON.parse(extractJson(text));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[generatePersonaActions] Failed to parse LLM response:', text.slice(0, 300), err);
    return [];
  }
}
