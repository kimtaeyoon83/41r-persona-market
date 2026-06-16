# 41R 파트너 연동 가이드 (워크스페이스 키 방식)

> 최신화: 2026-06-15 — 콘솔 셀프서브 **워크스페이스 키** 기준.
> 글밭(geulbat)이 첫 적용 사례이며, 모든 파트너가 동일한 방식으로 연동한다.
> 코드상 소스오브트루스: `apps/api/src/routes/partner.ts` ·
> `apps/api/src/middleware/partner.ts` · `apps/api/src/services/workspaces.ts`.

파트너 사이트가 유저의 ①프로필 ②사용 행동 ③앱 평가(설문)를 41R로
흘려보내고, 유저는 같은 이메일(구글 등)로 41R에 로그인하면 자기 데이터·
포인트를 관리하는 구조. 41R 측 인프라는 전부 배포 완료 — 이 문서는
**파트너 레포에서 할 일**의 전부다.

---

## 0. 준비물 — 콘솔에서 키 발급

1. `https://app.project-rpm.xyz/console` 로그인 → **Add site** → 사이트 URL 등록
2. 등록 직후 화면에 **1회만** 표시되는 값 두 개를 복사:

| 키 | 형식 | 성격 | 보관 위치 |
|---|---|---|---|
| **site key** | `rpm_pk_…` (31자) | 공개 — GA 측정 ID 동급. 비콘 라우팅 전용 | 클라이언트 노출 OK |
| **secret** | `rpm_sk_…` (55자) | 비밀 — S2S 인증 + HMAC 서명. **1회만 표시** | 파트너 **서버 env만**. git/번들 금지 |

> 두 키 모두 **읽기 권한이 없다.** 유출 시 피해 범위는 "가짜 데이터 주입"
> 뿐이며 데이터 탈취는 불가능(읽기는 Privy 세션 전용). secret을
> 재발급(rotate)하면 기존에 발급된 핸드오프/identify 토큰은 즉시
> 무효화된다(의도된 동작).

3. **사이트 분석(스캔) 1회** — 콘솔에서 자기 사이트를 한 번 분석한다
   (`/console/sites/<id>` Overview → "이 사이트 분석"). 이게 끝나면
   그 결과가 **워크스페이스 앵커로 자동 설정**된다 — 파트너가 scanId를
   따로 받아 env에 박을 필요가 없다. 설문은 이 앵커에 자동으로 묶여
   AI 예측 ↔ 사람 응답이 같은 페이지로 정렬된다(캘리브레이션 쇼케이스).

   > ⚠️ 2026-06-15 변경: 예전의 `RPM_ANCHOR_SCAN_ID`는 **제거됐다.**
   > `session-token`/`survey`는 secret으로 워크스페이스를 식별해 앵커를
   > 서버가 알아서 고른다. 스캔이 0건이면 `409 no_anchor_scan` —
   > "콘솔에서 분석 먼저 돌려라"는 신호.

4. **워크스페이스 id** — `/console/sites/<id>` 상세 URL의 `<id>`(UUID).
   §1-1의 `data-uid` 자체 발급을 쓸 때만 필요하다(설문 핸드오프엔 불필요).

파트너 서버 env 권장 구성:

```bash
RPM_API_BASE=https://api.project-rpm.xyz
RPM_SITE_KEY=rpm_pk_xxxxxxxxxxxxxxxxxxxxxxxx        # 공개 — 클라 스니펫용
RPM_PARTNER_SECRET=rpm_sk_xxxxxxxxxxxxxxxxxxxxxxxx  # 비밀 — 서버 전용
RPM_WORKSPACE_ID=<워크스페이스 UUID>                # data-uid 자체 발급 시에만
# RPM_ANCHOR_SCAN_ID 은 더 이상 필요 없음 (워크스페이스 앵커 자동 해석)
```

---

## 1. 트래킹 — 스크립트 한 줄 (GA 방식, 코드 변경 없음)

`app/layout.tsx`의 `<head>`(또는 next/script)에 1줄. `data-site`에는
**site key(`rpm_pk_…`)**를 넣는다 (secret 아님):

```tsx
<script
  src="https://api.project-rpm.xyz/api/partner/t.js"
  data-site="rpm_pk_xxxxxxxxxxxxxxxxxxxxxxxx"
  defer
/>
```

자동 수집 (이후 코드 변경 0):
- `pageview` — SPA 라우트 변경 포함 (History API 패치)
- `dwell` — 페이지 떠날 때 체류 ms + 최대 스크롤 %
- `session_start` / `session_end` — 30분 idle 규칙
- 전송: `sendBeacon` 배치(text/plain) — CORS simple request라 preflight
  없음, 탭 닫혀도 전송 보장

**수집하지 않는 것 (동의 문구의 근거):** 글 내용·제목·키 입력·폼 값.
payload는 경로/시간/스크롤뿐이다.

> 월 비콘 소프트캡 10만 이벤트/키. 초과분은 **조용히 폐기(204)**되어
> 페이지를 절대 깨지 않는다 — 사용량은 콘솔 Analytics 탭 게이지로 확인.

### 1-1. (선택) email 조인 — `data-uid`

기본은 익명 디바이스 id(localStorage). 로그인 유저의 행동을 email로
묶으려면 파트너 서버가 페이지 렌더 시 **서명된 identify 토큰**을
`data-uid`로 추가한다.

> ⚠️ 2026-06-12 변경: 토큰 서명 키는 secret **평문이 아니라 그 SHA-256
> 해시**이고, payload에 **워크스페이스 id**가 들어간다. 아래 헬퍼는
> 41R의 `signToken`/`verifyToken`과 정확히 일치하게 작성된 것 —
> 한 글자라도 어긋나면 HMAC 검증에 실패한다.

```ts
// lib/rpm-token.ts  (파트너 서버 전용)
import { createHash, createHmac } from "node:crypto";

const b64url = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 41R identify 토큰. 서명 키 = sha256(secret). payload.w = 워크스페이스 id.
 *  TTL 30분 — 페이지 렌더마다 새로 발급하므로 실질 제약 없음. */
export function mintRpmIdentify(email: string): string {
  const signingKey = createHash("sha256")
    .update(process.env.RPM_PARTNER_SECRET!)
    .digest("hex");
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        e: email.toLowerCase(),
        s: "identify",          // 행동 식별용 placeholder (truthy면 됨)
        w: process.env.RPM_WORKSPACE_ID!,
        x: exp,
      }),
    ),
  );
  const sig = b64url(createHmac("sha256", signingKey).update(payload).digest());
  return `${payload}.${sig}`;
}
```

```tsx
// app/layout.tsx (서버 컴포넌트) — 세션 있고 동의한 유저만
const session = await auth();
const uid =
  session?.user?.email ? mintRpmIdentify(session.user.email) : undefined;
// ...
<script src=".../t.js" data-site={process.env.NEXT_PUBLIC_RPM_SITE_KEY}
  {...(uid && { "data-uid": uid })} defer />
```

토큰이 무효/만료여도 트래킹은 **익명으로 강등될 뿐 페이지는 안 깨진다.**
익명 시절 이벤트도 `anon_id`로 남아 추후 소급 조인 가능.

---

## 2. 설문 — 버튼 1개 + 서버 호출 1개 (폼은 41R이 호스팅)

설문 UI·질문(SUS-10 + 사이트 맞춤 질문)은 전부 41R 페이지다. 파트너는
토큰을 받아 유저를 보내기만 한다. **설문이 바뀌어도 파트너 무배포.**
이 경로는 토큰을 41R 서버가 발급하므로 §1-1의 자체 서명이 필요 없다.

```ts
// app/api/rpm-survey/route.ts — 파트너 서버 라우트
import { auth } from "@/auth";

export async function POST() {
  const session = await auth();
  if (!session?.user?.email)
    return Response.json({ error: "unauthorized" }, { status: 401 });

  const r = await fetch(`${process.env.RPM_API_BASE}/api/partner/session-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-partner-key": process.env.RPM_PARTNER_SECRET!,   // rpm_sk_…
    },
    // scan_id 생략 — 서버가 워크스페이스 앵커를 자동으로 사용한다.
    // (특정 스캔을 노릴 때만 scan_id 를 넣으면 된다.)
    body: JSON.stringify({ email: session.user.email }),
  });
  if (!r.ok) return Response.json({ error: "token_failed" }, { status: 502 });
  const { survey_url } = await r.json();   // 41R이 만든 ?pt=<token> URL
  return Response.json({ survey_url });     // 클라가 이 URL로 이동(새 탭 권장)
}
```

```tsx
// 버튼 — 동의 문구와 함께
<button onClick={async () => {
  const r = await fetch("/api/rpm-survey", { method: "POST" });
  const { survey_url } = await r.json();
  window.open(survey_url, "_blank");
}}>
  설문하고 100P 받기
</button>
```

흐름: 유저가 41R 설문 페이지(`?pt=<token>`)에서 작성 → 제출 시 첫 제출에
한해 **+100P 적립** + "같은 계정으로 41R 로그인하면 포인트·응답 관리
가능" 안내. 재제출은 수정으로 처리(포인트 재적립 없음, 스캔당 보상 30건
상한 — 초과 시 0P 행이 투명하게 기록됨).

> **scan은 `completed` 상태여야** 토큰 발급/제출이 된다. 미완료면
> `409 scan_not_completed`.

---

## 3. 프로필 — 가입/설정 변경 시 서버 push (선택)

```ts
await fetch(`${process.env.RPM_API_BASE}/api/partner/profile`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-partner-key": process.env.RPM_PARTNER_SECRET!,   // rpm_sk_…
  },
  body: JSON.stringify({
    email: session.user.email,
    consent: true,             // 옵트인 안 한 유저는 보내지 말 것 (literal true 필수)
    profile: {                 // 자유 형식 jsonb (비어있으면 400). 권장 키:
      age_range: "30s",        // '10s'|'20s'|'30s'|'40s'|'50s'|'60+'
      region: "Seoul",
      occupation: "developer",
      // 도메인 성향 필드 자유 추가 (writing_frequency 등)
    },
  }),
});
```

`(source, email)`당 1행 upsert — 변경 시 재호출하면 갱신된다.

---

## 4. (폴백) S2S 직접 전송 — 파트너가 폼/행동을 자체 보유할 때

호스티드 핸드오프(§2)·드롭인 스니펫(§1) 대신 파트너가 직접 보낼 수도 있다.
둘 다 `x-partner-key: rpm_sk_…` 필요.

**설문 S2S** — 파트너가 자기 폼을 렌더하고 답을 직접 전송:
```ts
POST /api/partner/survey
body: { scan_id, email, consent: true, ...surveyBody }
//   surveyBody = { sus_responses, engagement_category, signup_likelihood,
//                  retention_category, completion_likelihood, voice,
//                  custom_answers, demographics }
//   정확한 필드/검증은 apps/api/src/routes/scan.ts 의 surveyBody Zod 스키마 참조
```

**행동 배치 S2S** — 파트너가 이벤트를 자기 DB에 쌓다가 배치 동기화:
```ts
POST /api/partner/behavior
body: {
  email,
  events: [   // 1~500개
    { session_id?, event_type, payload?, occurred_at /* ISO 8601 */ }
  ]
}
```

---

## 5. 동의 / 개인정보

설문 진입 전 또는 설정에서 옵트인 1회 (체크박스):

> 서비스 이용 패턴(방문 페이지·체류 시간)과 설문 응답, 프로필 정보가
> 페르소나 연구(41R)에 활용되는 것에 동의합니다.
> **작성하신 글의 내용은 수집되지 않습니다.**

- 유저 레코드에 `researchConsent: boolean` 저장
- 미동의 유저: `data-uid` 미렌더(익명 트래킹만) 또는 스니펫 자체 미렌더,
  설문 버튼 미노출, 프로필/설문 S2S push 금지
- 파트너 개인정보처리방침에 제3자 제공(41R) 항목 추가
- API는 `consent: true`(literal) 없는 프로필/설문 S2S 요청을 거부한다 —
  동의는 "행이 존재한다는 사실 자체"로 기록된다.

---

## 6. 검증 절차 (연동 후)

```
1) 스니펫 적재 — 파트너 페이지 열고 몇 번 이동 → 콘솔 Analytics 탭에
   visitors/pageviews 가 잡히는지 (또는 41R DB partner_behavior_events
   에서 source='ws:<워크스페이스 id>' 최신행 확인)
2) 설문 e2e — 버튼 → 41R 설문 페이지 → 제출 → 첫 제출 201 {points_awarded:100}
3) 클레임 — 같은 이메일로 app.project-rpm.xyz 로그인
   → /me/responses 에 응답 표시 + GET /api/me/points 잔액 100
```

문제 시 41R 로그: Railway api 서비스, `service:"partner_ingest"` /
`service:"partner_auth"` 필터.

---

## 7. 41R 측 엔드포인트 참조 (구현 완료, 변경 불필요)

| 엔드포인트 | 인증 | 용도 |
|---|---|---|
| `GET /api/partner/t.js` | 없음 (공개) | 트래킹 스니펫 |
| `POST /api/partner/t` | site key (body `k`) | 비콘 수집 (text/plain) |
| `POST /api/partner/session-token` | `x-partner-key: rpm_sk_` | 설문 핸드오프 토큰 발급 |
| `POST /api/partner/survey-by-token` | 토큰 (브라우저) | 호스티드 설문 제출 |
| `POST /api/partner/profile` | `x-partner-key: rpm_sk_` | 프로필 upsert |
| `POST /api/partner/survey` | `x-partner-key: rpm_sk_` | (폴백) S2S 설문 |
| `POST /api/partner/behavior` | `x-partner-key: rpm_sk_` | (폴백) S2S 행동 배치 |

인증 동작: `x-partner-key` 헤더 없음 → 401 / 알 수 없는 secret → 403 /
매치 → `req.partnerSource = 'ws:<id>'`.

데이터 행선지: `partner_behavior_events` / `partner_profiles` /
`survey_responses`(+`calibration_records`) / `point_transactions`.
모두 email 키로 대기하다가 해당 email이 41R에 Privy 로그인하는 순간
본인 계정에 자동 귀속된다 (`middleware/privy_auth.ts::claimPartnerRows`,
비차단·로그인 절대 안 막음).

---

## 8. 체크리스트

- [ ] 콘솔 Add site → `rpm_pk_` / `rpm_sk_` 발급 (secret 1회 복사)
- [ ] 콘솔에서 자기 사이트 분석 1회 → 앵커 자동 생성 (scanId 따로 보관 X)
- [ ] 파트너 서버 env 설정 (`RPM_*` — `RPM_ANCHOR_SCAN_ID` 불필요)
- [ ] layout에 스니펫 1줄 (`data-site=rpm_pk_…`)
- [ ] (선택) `lib/rpm-token.ts` + `data-uid` 렌더 (`RPM_WORKSPACE_ID` 필요)
- [ ] `/api/rpm-survey` 라우트 + 설문 버튼 (핸드오프)
- [ ] (선택) 프로필 push 훅 / 행동·설문 S2S 폴백
- [ ] 동의 플래그/문구 + 개인정보처리방침 갱신
- [ ] §6 검증 3종 통과
```
