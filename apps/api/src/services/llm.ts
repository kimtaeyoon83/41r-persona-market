import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { GeneratedTestCases, PersonaVector } from '@41rpm/shared';

const client = new Anthropic();

const SONNET = 'claude-sonnet-4-6-20250514';
const HAIKU = 'claude-haiku-4-5-20251001';

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
  const prompt = `You are a persona analysis expert. Analyze this tester's profile and their 3 test reports to create a Persona Vector.

[Profile] ${JSON.stringify(profile)}
[Report 1] ${JSON.stringify(reports[0])}
[Report 2] ${JSON.stringify(reports[1])}
[Report 3] ${JSON.stringify(reports[2])}

Generate a JSON object with this structure (all numeric values 0.0-1.0):
{
  "test_style": { "thoroughness": 0.0-1.0, "speed": 0.0-1.0, "ux_focus": 0.0-1.0, "bug_detection": 0.0-1.0, "creativity": 0.0-1.0 },
  "expertise": { "defi": 0.0-1.0, "nft": 0.0-1.0, "gaming": 0.0-1.0, "ai_tools": 0.0-1.0, "general_web": 0.0-1.0 },
  "feedback_pattern": { "ui_critical": 0.0-1.0, "security_aware": 0.0-1.0, "performance_sensitive": 0.0-1.0, "accessibility_focus": 0.0-1.0, "detail_oriented": 0.0-1.0 },
  "reliability": { "quality_score": 0.0-1.0, "consistency": 0.0-1.0, "response_rate": 0.0-1.0 },
  "voice_sample": "2-3 sentence description of this tester's characteristic feedback style"
}

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
