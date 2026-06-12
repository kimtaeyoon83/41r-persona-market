# 글밭 × 41R 파트너 통합 가이드

> **⚠️ BREAKING — 2026-06-12 키 체계 전면 교체 (이 가이드 적용 전 필독)**
>
> 글밭 전용 env 키 체계가 제거되고 **콘솔 셀프서브 워크스페이스 키**로
> 바뀌었다. 글밭 구현이 시작되기 전이므로 아래 매핑으로 읽으면 가이드의
> 나머지(페이로드·플로우·동의 계약)는 전부 그대로 유효하다:
>
> | 이 문서의 표기 (구) | 실제 사용 값 (신) |
> |---|---|
> | `PARTNER_API_KEY_GEULBAT` (S2S 비밀키) | 41R 콘솔에서 글밭 사이트 등록 시 1회 표시되는 `rpm_sk_…` secret |
> | `rpms_geulbat_…` (site key) | 같은 워크스페이스의 `rpm_pk_…` site key (설정 탭에서 복사) |
> | `POST /api/partner/geulbat/survey` | `POST /api/partner/survey` |
> | `POST /api/partner/geulbat/session-token` | `POST /api/partner/session-token` |
> | `POST /api/partner/geulbat/survey-by-token` | `POST /api/partner/survey-by-token` |
> | `POST /api/partner/geulbat/profile` | `POST /api/partner/profile` |
> | `POST /api/partner/geulbat/behavior` | `POST /api/partner/behavior` |
> | `/api/partner/t.js` + `/t` (비콘) | 동일 (data-site에 `rpm_pk_…` 사용) |
>
> 키 발급: 41R 콘솔 → Add site → geulbat URL 등록 → secret 1회 복사.
> secret 재발급 시 발급된 핸드오프 토큰은 즉시 무효화된다(의도된 동작).

> 글밭(geulbat) 파일럿 — 유저의 ①프로필 ②사용 행동 ③앱 평가(설문)를
> 41R로 흘려보내고, 유저는 같은 구글 계정으로 41R에 로그인하면
> 자기 데이터·포인트를 관리하는 구조. 41R 측 인프라는 2026-06-10
> 전부 배포 완료 — 이 문서는 **글밭 레포에서 할 일**의 전부다.

## 0. 준비물

| 항목 | 값 | 보관 위치 |
|---|---|---|
| S2S 파트너 키 (비밀) | `PARTNER_API_KEY_GEULBAT` | Railway **api 서비스 env**에서 복사 → 글밭 서버 env로. **클라이언트 번들·git 커밋 금지** |
| 트래킹 site key (공개) | `rpms_geulbat_b41a617c9afddda8fc1d8433` | GA 측정 ID와 동급 — 노출 무해 |
| 앵커 scanId | *(미발급 — 글밭 프로덕션 URL로 41R 스캔 1회 후 확정)* | 글밭 서버 env `RPM_ANCHOR_SCAN_ID` |
| API 베이스 | `https://api.project-rpm.xyz` | |

글밭 서버 env 권장 구성:

```bash
RPM_API_BASE=https://api.project-rpm.xyz
RPM_PARTNER_KEY=<Railway api 서비스의 PARTNER_API_KEY_GEULBAT 값>
RPM_SITE_KEY=rpms_geulbat_b41a617c9afddda8fc1d8433
RPM_ANCHOR_SCAN_ID=<발급 후 기입>
```

---

## 1. 트래킹 — 스크립트 한 줄 (GA 방식, 코드 변경 없음)

`app/layout.tsx`의 `<head>`(또는 next/script)에 1줄:

```tsx
<script
  src="https://api.project-rpm.xyz/api/partner/t.js"
  data-site="rpms_geulbat_b41a617c9afddda8fc1d8433"
  defer
/>
```

자동 수집 (이후 코드 변경 0):
- `pageview` — SPA 라우트 변경 포함 (History API 패치)
- `dwell` — 페이지 떠날 때 체류 ms + 최대 스크롤 %
- `session_start` / `session_end` — 30분 idle 규칙
- 전송: sendBeacon 배치 (탭 닫혀도 보장, preflight 없음)

**수집하지 않는 것 (동의 문구의 근거):** 글 내용·제목·키 입력·폼 값.
payload는 경로/시간/스크롤뿐이다.

### 1-1. (선택) email 조인 — `data-uid`

기본은 익명 디바이스 id. 로그인 유저의 행동을 email로 묶으려면
글밭 서버가 페이지 렌더 시 서명 토큰을 한 줄 추가:

```tsx
// app/layout.tsx (서버 컴포넌트) — 세션 있을 때만
const session = await auth();
const uid = session?.user?.email ? mintRpmToken(session.user.email) : undefined;
// ...
<script src=".../t.js" data-site="..." {...(uid && { "data-uid": uid })} defer />
```

토큰 생성 헬퍼 (글밭 서버 전용 — 키가 있으니 자체 생성 가능):

```ts
// lib/rpm-token.ts
import { createHmac } from "node:crypto";

const b64url = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 41R HMAC 핸드오프 토큰. scanId 자리는 트래킹 identify 용도일 땐
 *  아무 placeholder("identify")면 된다. TTL 30분 — 페이지 렌더마다
 *  새로 발급되므로 실질 제약 없음. */
export function mintRpmToken(email: string, scanId = "identify"): string {
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;
  const payload = b64url(
    Buffer.from(JSON.stringify({ e: email.toLowerCase(), s: scanId, x: exp })),
  );
  const sig = b64url(
    createHmac("sha256", process.env.RPM_PARTNER_KEY!).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}
```

토큰이 무효/만료여도 트래킹은 **익명으로 강등될 뿐 페이지는 안 깨진다.**
익명 시절 이벤트도 `anon_id`로 남아 있어 추후 소급 조인 가능.

---

## 2. 설문 — 버튼 1개 + 서버 호출 1개 (폼은 41R이 호스팅)

설문 UI·질문(SUS-10 + 사이트 맞춤 질문)은 전부 41R 페이지다.
글밭은 토큰을 받아 유저를 보내기만 한다. **설문이 바뀌어도 글밭 무배포.**

```ts
// app/api/rpm-survey/route.ts — 글밭 서버 라우트
import { auth } from "@/auth";

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) return Response.json({ error: "unauthorized" }, { status: 401 });

  const r = await fetch(`${process.env.RPM_API_BASE}/api/partner/geulbat/session-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-partner-key": process.env.RPM_PARTNER_KEY!,
    },
    body: JSON.stringify({
      email: session.user.email,
      scan_id: process.env.RPM_ANCHOR_SCAN_ID,
    }),
  });
  if (!r.ok) return Response.json({ error: "token_failed" }, { status: 502 });
  const { survey_url } = await r.json();
  return Response.json({ survey_url }); // 클라가 이 URL로 이동 (새 탭 권장)
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

흐름: 유저가 41R 설문 페이지(`?pt=<token>`)에서 작성 → 제출 시
**+100P 적립** + "같은 구글 계정으로 41R 로그인하면 포인트·응답 관리
가능" 안내가 표시됨. 재제출은 수정으로 처리(포인트 재적립 없음).

---

## 3. 프로필 — 가입/설정 변경 시 서버 push (선택)

```ts
await fetch(`${process.env.RPM_API_BASE}/api/partner/geulbat/profile`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-partner-key": process.env.RPM_PARTNER_KEY! },
  body: JSON.stringify({
    email: session.user.email,
    consent: true, // 옵트인 안 한 유저는 보내지 말 것
    profile: {
      // 자유 형식 jsonb — 글밭이 가진 필드를 그대로. 권장 키:
      age_range: "30s",          // '10s'|'20s'|'30s'|'40s'|'50s'|'60+'
      region: "Seoul",
      occupation: "developer",
      // 그 외 글밭 도메인 성향 필드 자유 추가 (writing_frequency 등)
    },
  }),
});
```

(source, email)당 1행 upsert — 변경 시 재호출하면 갱신된다.

---

## 4. 동의 / 개인정보

설문 진입 전 or 설정에서 옵트인 1회 (체크박스):

> 서비스 이용 패턴(방문 페이지·체류 시간)과 설문 응답, 프로필 정보가
> 페르소나 연구(41R)에 활용되는 것에 동의합니다.
> **작성하신 글의 내용은 수집되지 않습니다.**

- 유저 레코드에 `researchConsent: boolean` 저장
- 미동의 유저: 스니펫의 `data-uid`를 렌더하지 않고(익명 트래킹만 또는
  스니펫 자체 미렌더 — 정책 선택), 설문 버튼 미노출, 프로필 push 금지
- 글밭 개인정보처리방침에 제3자 제공(41R) 항목 추가

---

## 5. 검증 절차 (연동 후)

```bash
# 1) 스니펫 적재 확인 — 글밭 페이지 열고 몇 번 이동한 뒤:
#    (41R DB) SELECT event_type, payload FROM partner_behavior_events
#             WHERE source='geulbat' ORDER BY created_at DESC LIMIT 5;
# 2) 설문 e2e — 버튼 → 41R 페이지 → 제출 → 201 {points_awarded:100}
# 3) 클레임 — 같은 구글 계정으로 app.project-rpm.xyz 로그인
#    → /me/responses에 응답 표시 + GET /api/me/points 잔액 100
```

문제 시 41R 로그: Railway api 서비스, `service:"partner_ingest"` 필터.

---

## 6. 41R 측 참조 (구현 완료, 변경 불필요)

| 엔드포인트 | 인증 | 용도 |
|---|---|---|
| `GET /api/partner/t.js` | 없음 (공개) | 트래킹 스니펫 |
| `POST /api/partner/t` | site key (body) | 비콘 수집 (text/plain) |
| `POST /api/partner/geulbat/session-token` | partner key | 설문 핸드오프 토큰 발급 |
| `POST /api/partner/geulbat/survey-by-token` | 토큰 (브라우저) | 호스티드 설문 제출 |
| `POST /api/partner/geulbat/profile` | partner key | 프로필 upsert |
| `POST /api/partner/geulbat/survey` | partner key | (폴백) S2S 설문 |
| `POST /api/partner/geulbat/behavior` | partner key | (폴백) S2S 행동 배치 |

데이터 행선지: `partner_behavior_events` / `partner_profiles` /
`survey_responses`(+`calibration_records`) / `point_transactions`.
모두 email 키로 대기하다가 해당 email이 41R에 Privy 구글 로그인하는
순간 자동으로 본인 계정에 귀속된다
(`middleware/privy_auth.ts::claimPartnerRows`).

## 7. 체크리스트

- [ ] 글밭 env 4개 설정 (`RPM_*`)
- [ ] 41R로 글밭 스캔 1회 → `RPM_ANCHOR_SCAN_ID` 확정
- [ ] layout에 스니펫 1줄 (+선택: data-uid 토큰 렌더)
- [ ] `lib/rpm-token.ts` + `/api/rpm-survey` 라우트 + 설문 버튼
- [ ] 동의 플래그/문구 + 개인정보처리방침 갱신
- [ ] (선택) 프로필 push 훅
- [ ] §5 검증 3종 통과
