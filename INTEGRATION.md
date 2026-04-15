# persona_agent 통합 가이드

41rpm API(Express)가 persona_agent의 분석 엔진을 HTTP로 호출하는 방식.
엔진은 stateless — Solana/USDC/DB는 기존 Express 레이어가 계속 담당.

## 구성

```
[apps/web]  Next.js :3000
     │
     ▼
[apps/api]  Express :4100
     │  (uses @41rpm/persona-client)
     ▼  HTTP
[apps/persona-engine]  FastAPI :4200  ← persona_agent 래핑
     │
     ▼  fs
[/var/persona_jobs]    workspace (personas, sessions, cohort_results, reports)
```

## 새로 추가된 것

| 위치 | 역할 |
|---|---|
| `apps/persona-engine/` | Python FastAPI 서비스 (persona_agent 래퍼) |
| `apps/persona-engine/main.py` | 6 엔드포인트 (health, personas×2, analyses×3) |
| `apps/persona-engine/adapters/tester_to_soul.py` | TesterProfile → Soul + 5축 traits |
| `apps/persona-engine/adapters/r2_upload.py` | 스크린샷 → Cloudflare R2 |
| `apps/persona-engine/adapters/job_store.py` | 파일 기반 job 상태 (MVP) |
| `apps/persona-engine/Dockerfile` | Railway 배포용 (python + chromium) |
| `packages/persona-client/` | TypeScript 클라이언트 (`@41rpm/persona-client`) |
| `docker-compose.yml` | `persona-engine` 서비스 추가 (포트 4201) |

## 로컬 개발 흐름

### 1) 공통 세팅
```bash
# 루트 .env
ANTHROPIC_API_KEY=sk-ant-...
```

### 2) 엔진 단독 실행 (개발 중)
```bash
cd apps/persona-engine
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m playwright install chromium

export PERSONA_ENGINE_WORKSPACE=./workspace
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY ../../.env | cut -d= -f2)
uvicorn main:app --reload --port 4200
```

확인:
```bash
curl http://localhost:4200/health
curl http://localhost:4200/personas
```

### 3) 전체 스택 (docker-compose)
```bash
docker compose up -d
# db     :5433
# api    :4101
# web    :3001
# engine :4201
```

### 4) TS 클라이언트 빌드
```bash
pnpm --filter @41rpm/persona-client build
pnpm --filter api add @41rpm/persona-client
```

## Express 통합 예시 (apps/api/src/services/autotest.ts 대체 경로)

```ts
// apps/api/src/services/persona_engine.ts (new)
import { PersonaEngineClient } from '@41rpm/persona-client';

const engine = new PersonaEngineClient({
  baseUrl: process.env.PERSONA_ENGINE_URL ?? 'http://persona-engine:4200',
});

export async function runAutoTestWithEngine(args: {
  testId: string;
  personaId: string;
  testerProfile: TesterProfile;  // from DB
  url: string;
  task: string;
}): Promise<{ outcome: string; totalTurns: number; reportId: string | null }> {

  // 1) 페르소나가 엔진에 없으면 등록
  const { personas } = await engine.listPersonas();
  if (!personas.includes(args.personaId)) {
    await engine.createPersona({
      persona_id: args.personaId,
      profile: args.testerProfile,
    });
  }

  // 2) 분석 submit
  const { job_id } = await engine.submitAnalysis({
    persona_id: args.personaId,
    url: args.url,
    task: args.task,
    mode: 'browser',
  });

  // 3) 완료 대기 (10분 한도)
  const result = await engine.waitForResult(job_id, { maxWaitMs: 10 * 60_000 });

  // 4) DB에 결과 저장 (기존 Drizzle 스키마 재사용)
  await db.insert(schema.testReports).values({
    testId: args.testId,
    testerAddr: args.personaId,
    outcome: result.outcome ?? 'unknown',
    totalTurns: result.total_turns ?? 0,
    reportId: result.report_id,
    // screenshots: later via r2_upload adapter
  });

  return {
    outcome: result.outcome ?? 'unknown',
    totalTurns: result.total_turns ?? 0,
    reportId: result.report_id,
  };
}
```

## 기존 `startAutoTest` 마이그레이션 단계 (제안)

1. 엔진 배포 → Railway에 `persona-engine` 서비스 추가, `PERSONA_ENGINE_URL` 환경변수 세팅
2. `apps/api/src/services/persona_engine.ts` 추가 (위 코드)
3. `autotest.ts`의 Stagehand 로직을 persona_engine 호출로 대체 (feature-flag로 점진 이전)
4. Stagehand 제거 (`packages.json`에서 dependency 삭제)
5. 스크린샷 경로를 `r2_upload.upload_session_screenshots()`로 라우트

## 배포 (Railway)

### 엔진 서비스 추가
1. Railway 대시보드에서 새 서비스 생성
2. Root: `apps/persona-engine/`
3. Dockerfile: `apps/persona-engine/Dockerfile`
4. 환경변수:
   - `ANTHROPIC_API_KEY` (required)
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`
   - `PERSONA_ENGINE_WORKSPACE=/var/persona_jobs`
5. Volume: `/var/persona_jobs` (페르소나 진화 지속 필요 시)
6. `apps/persona-engine/pyproject.toml`에서 `persona_agent` 의존을 git form으로 스왑:
   ```toml
   "persona_agent[browser,analysis,benchmark] @ git+ssh://git@github.com/kimtaeyoon83/41r-advisor.git#subdirectory=persona_agent"
   ```

### API 환경변수 업데이트
- `PERSONA_ENGINE_URL=https://persona-engine-production-xxxx.up.railway.app`

## 새 가치: 페르소나 진화

기존 `startAutoTest`는 매 세션 stateless. 엔진 기반 구조에서는:

- 테스터 A의 페르소나가 사이트 10개를 방문하면 `workspace/personas/tester_A/history/`에 observation 100+ 개 누적
- 11번째 사이트 테스트 때 `read_persona`가 이 history를 LLM 플랜 프롬프트에 자동 주입
- 장기적으로 Solana SAS attestation과 결합 — "이 페르소나는 검증된 50회 테스트 경험" 온체인 기록 가능

## 참고

- persona_agent 아키텍처: `../41r-advisor/persona_agent/ARCHITECTURE.md`
- persona_agent 커밋: https://github.com/kimtaeyoon83/41r-advisor/commit/a650cb1
