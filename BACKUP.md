# 41R — Tester Marketplace Archive

> **Pivot 날짜:** 2026-05-04
> **Anchor tag:** `v0-tester-marketplace-frozen` (commit `0191d30`)
> **Backup folder (this branch):** `backup/`

이 문서는 41R이 **Audience-Fit Validator 단일 제품**으로 전환되면서, 이전의
**Solana 기반 Tester Marketplace + Autotest** 인프라가 어디로 갔는지를 기록합니다.

---

## 1. 어디로 갔나

| 원래 위치 | 백업 위치 | 비고 |
|---|---|---|
| `apps/web/app/{company,tester,autotest,autotest-bsc,x402,experiment,report,persona}/` | `backup/web/app/<same>/` | 페이지 트리 전체 |
| `apps/web/app/page.tsx` (구 홈페이지) | `backup/web/app/old-homepage.tsx` | 새 홈페이지로 교체 |
| `apps/web/app/validator/pro/` | `backup/web/app/validator-pro/` | D8 — Pro tier 폐기 |
| `apps/web/components/{topbar,sidebar,var-tabs,persona-radar-20,radar-chart,sas-badge,tweaks-panel,wallet-button,dev-demo-banner}.tsx` | `backup/web/components/<same>` | autotest 전용 |
| `apps/api/src/routes/{test,tester,report,persona,autotest,autotest-bsc,dashboard,dev,x402-demo}.ts` | `backup/api/src/routes/<same>` | autotest API |
| `apps/api/src/services/{autotest,scoring,diagnosis,comparison,findings,stagehand_hybrid,dashboard,sas,matching,browser_quirks,video,queue_dedup,settlement-worker,evm,persona,persona_engine}.ts` | `backup/api/src/services/<same>` | autotest 백엔드 |
| `apps/api/src/middleware/x402.ts` | `backup/api/src/middleware/x402.ts` | D7 — x402 폐기 |
| `apps/api/src/__tests__/{matching,diagnosis,comparison,findings,scoring-*,autotest-*,stagehand-*,dashboard,funnel,persona-actions-*,settlement-worker,sas}.test.ts` | `backup/api/src/__tests__/<same>` | 위 코드의 단위 테스트 |
| `apps/persona-engine/` (디렉토리 전체) | **삭제됨** | D5 — Python FastAPI 서비스 폐기 |
| `packages/persona-client/` (디렉토리 전체) | **삭제됨** | persona-engine 의존, D5 |

---

## 2. main에서 살아남은 것 (Validator-only)

**API:**
- Routes: `auth.ts`, `hello.ts`, `scan.ts`, `calibration.ts`, `benchmark.ts`
- Services: `scan_pipeline.ts`, `audience_fit.ts`, `cohort_selection.ts`, `dimension_simulator.ts`, `dimensions/*`, `site_capture.ts`, `site_classifier.ts`, `aarrr.ts`, `benchmark.ts`, `calibration/*`, `r2.ts`, `anthropic_client.ts`, `llm.ts`, `health.ts`, `solana.ts`
- Middleware: `auth.ts`, `rate-limit.ts`, `cors`, `dev_auth.ts` (향후 Privy로 대체)

**Web:**
- `/validator/*` (전체)
- `/page.tsx` (Phase 2에서 Recent Analyses feed로 갱신)
- `/layout.tsx` (Phase 2에서 Privy로 갱신)
- Components: `app-shell`, `loading`, `error-display` (generic), `wallet-provider`/`evm-wallet-provider` (Phase 2에서 제거)

**Packages:**
- `packages/shared` (cohorts.ts + 기본 타입)
- `packages/solana-utils` (D6 — 0 USDC 트랜잭션용 보존)

---

## 3. 어떻게 복구하나

### A. tag로 시점 복원
```bash
git checkout v0-tester-marketplace-frozen
# 이 시점의 전체 코드 = pivot 이전 상태
```

### B. backup/ 폴더에서 특정 파일만 복구
```bash
# 예: services/autotest.ts 를 main으로 복구
git mv backup/api/src/services/autotest.ts apps/api/src/services/autotest.ts
# import 체인 깨진 것들 수동 복구 필요
# tsconfig/vitest의 backup/ exclude는 유지하되, 복구 파일 위치는 backup/ 밖이므로 자동 빌드 대상
```

---

## 4. 빌드 동작

`backup/` 폴더는 **모든 빌드/타입체크/테스트 대상에서 제외됨**:
- `apps/api/tsconfig.json` — `exclude: ["../../backup/**/*"]`
- `apps/web/tsconfig.json` — `exclude: ["../../backup/**/*"]`
- `apps/api/vitest.config.ts` — `test.exclude: ['**/backup/**']`
- Next.js — `app/` 디렉토리 외부라 자동 제외

따라서 `backup/` 안의 코드는 컴파일 안 되고 테스트도 안 돌아감. 단순히 **참조용
보존 파일**.

---

## 5. 나중에 부활시킬 가능성이 있는 자산

| 자산 | 부활 가능성 | 어떤 시점에 |
|---|---|---|
| Stagehand + scoring 파이프라인 | 높음 | Validator의 Pro tier "deep dive — 실제 브라우저 세션" 옵션 |
| Diagnosis 합성 (Sonnet) | 중간 | Pro tier에서 LLM-generated UX audit 리포트 |
| x402 미들웨어 | 높음 | Open Beta에서 API access ($0.10-0.50/call) 도입 시 |
| Settlement worker (USDC 분배) | 높음 | 페르소나 wallet에 보상 분배 (결정문서 §6.1 step 7) |
| Calibration framework | 항상 사용 | 인간 설문 ground truth와 LLM 비교 (D3) |
| SAS 어테스테이션 | 낮음 | Mainnet 시점 reputation/trust 인프라 |

---

## 6. v1.0 결정문서와의 관계

이번 pivot은 **41R Decision Doc v1.0 (2026-04-27)** 의 단일 제품 비전을
구현하기 위한 사전 정리입니다. 정리 후 Phase 2~4에서 다음을 통합:

- Privy 단일 인증 (§1)
- 단일 portal `41r.app` (§2)
- 0 USDC sponsored tx 결제 (§3, D6)
- 페르소나 wallet 인프라 (§7, D2)
- 인간 설문 calibration (§D3)
- AARRR funnel을 메인 report로 (§D8)

자세한 phase별 일정은 README 또는 PR 시리즈 참조.

---

**Last updated:** 2026-05-04
