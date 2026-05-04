import { describe, it, expect } from 'vitest';
import { buildPersonaSoul } from '../services/scoring/persona_soul.js';

// Smoke-level tests: the soul prose is opaque to unit-level assertion
// (it's a prompt, not data) — we just guard the field wiring so
// demographics / voice_sample / test_style don't silently drop out.

const fullVector = {
  test_style: {
    thoroughness: 0.9,
    speed: 0.3,
    ux_focus: 0.85,
    bug_detection: 0.7,
    creativity: 0.6,
  },
  expertise: { defi: 0.2, nft: 0.8, gaming: 0.5, ai_tools: 0.3, general_web: 0.9 },
  feedback_pattern: {
    ui_critical: 0.8,
    security_aware: 0.5,
    performance_sensitive: 0.7,
    accessibility_focus: 0.4,
    detail_oriented: 0.9,
  },
  reliability: { quality_score: 4.2, consistency: 0.85, response_rate: 0.9 },
  voice_sample: '모바일에서 터치 영역이 이렇게 작으면 아저씨들은 제대로 못 누른다구요.',
};

describe('buildPersonaSoul', () => {
  it('emits sections when full data provided', () => {
    const soul = buildPersonaSoul({
      persona: { id: 'p1', vector: fullVector as any },
      tester: {
        displayName: 'Tester',
        profile: {
          age_range: '40s',
          occupation: 'QA Engineer',
          region: 'KR',
          crypto_experience: 'advanced',
          primary_device: 'mobile',
          expertise: ['web'],
          experience_level: 'senior',
          preferred_domains: ['ecommerce'],
          ui_preference: 'high-density',
          languages: ['ko', 'en'],
          device_types: ['mobile'],
          design_matters: true,
          frustration_triggers: ['slow load', 'tiny buttons'],
        },
      },
    });
    expect(soul).toContain('연령대: 40s');
    expect(soul).toContain('직업: QA Engineer');
    expect(soul).toContain('암호화폐 경험: advanced');
    expect(soul).toContain('테스트 스타일');
    expect(soul).toContain('thoroughness');
    expect(soul).toContain('전문 도메인');
    expect(soul).toContain('보이스 샘플');
    expect(soul).toContain('모바일에서');
    expect(soul).toContain('tiny buttons');
  });

  it('degrades gracefully without tester profile', () => {
    const soul = buildPersonaSoul({
      persona: { id: 'p1', vector: fullVector as any },
      tester: null,
    });
    // Should still have style / expertise / voice blocks from vector only
    expect(soul).toContain('테스트 스타일');
    expect(soul).toContain('보이스 샘플');
    expect(soul).not.toContain('연령대'); // no profile → no demographics section
  });

  it('does not emit empty sections when vector is bare', () => {
    const soul = buildPersonaSoul({
      persona: {
        id: 'p1',
        vector: {
          test_style: {
            thoroughness: 0,
            speed: 0,
            ux_focus: 0,
            bug_detection: 0,
            creativity: 0,
          },
          expertise: { defi: 0, nft: 0, gaming: 0, ai_tools: 0, general_web: 0 },
          feedback_pattern: {
            ui_critical: 0,
            security_aware: 0,
            performance_sensitive: 0,
            accessibility_focus: 0,
            detail_oriented: 0,
          },
          reliability: { quality_score: 0, consistency: 0, response_rate: 0 },
          voice_sample: '',
        } as any,
      },
      tester: null,
    });
    // voice_sample empty → no voice section
    expect(soul).not.toContain('보이스 샘플');
  });
});
