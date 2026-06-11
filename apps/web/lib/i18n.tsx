"use client";

// Lightweight i18n (Console Sprint 1 — console-ia-redesign.md §12
// decision 5: English default + Korean, no hardcoded single language).
//
// Deliberately NOT next-intl / locale-routing: the console is the only
// translated surface for now and a dictionary + context covers it.
// Locale persists in localStorage (`41r-locale`); no URL segment, so
// links stay shareable without locale prefixes. New console/me screens
// must use t() from day one; legacy validator pages migrate on touch.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Locale = "en" | "ko";

const STORAGE_KEY = "41r-locale";

const en = {
  "nav.console": "Console",
  "nav.myPage": "My Page",
  "nav.signIn": "Sign in",
  "nav.signOut": "Sign out",

  "common.loading": "Loading…",
  "common.back": "Back",
  "common.home": "Home",
  "common.signInTitle": "Sign in to continue",
  "common.signInBody": "Sign up and get $30 in free credits — about 15 scans.",
  "common.retry": "Retry",

  "console.title": "Sites",
  "console.subtitle": "Your analyses, grouped by site.",
  "console.newAnalysis": "+ New analysis",
  "console.creditsLeft": "credits left",
  "console.scansUnit": "scans",
  "console.lastScan": "last scan",
  "console.emptyTitle":
    "Drop a URL and 112 AI personas will tell you who your customers are — in about 3 minutes.",
  "console.emptySub": "Your $30 welcome credit covers ~15 scans.",
  "console.emptyCta": "Run your first analysis",
  "console.bestFit": "Best-fit audience",
  "console.misfit": "Misfit",
  "console.overview": "Overview",
  "console.reports": "Reports",
  "console.rescan": "Re-scan",
  "console.scanHistory": "Scan history",
  "console.surveyResponses": "survey responses",
  "console.humanCompared": "human comparison ready",
  "console.copySurveyLink": "Copy survey link",
  "console.copied": "Copied!",
  "console.compareRun": "Compare with humans",
  "console.openReport": "Report",
  "console.openCompare": "AI vs Human",
  "console.shareMd": "report.md",
  "console.publicNote":
    "Reports are viewable by anyone who has the link (unlisted).",
  "console.insufficient": "Not enough credits",
  "console.date": "Date",
  "console.mode": "Mode",
  "console.score": "Score",
  "console.personas": "Personas",
  "console.status": "Status",
  "console.noCompleted": "No completed scans yet for this site.",
  "console.addSite": "+ Add site",
  "console.unassigned": "Unassigned scans",
  "console.unassignedSub": "Scans not linked to a site yet.",
  "console.registerAsSite": "Register as site",
  "console.settings": "Settings",
  "console.siteName": "Site name",
  "console.save": "Save",
  "console.saved": "Saved",
  "console.siteKeyLabel": "Site key (public)",
  "console.secretLabel": "Secret key (server-only)",
  "console.rotate": "Rotate",
  "console.rotateConfirm":
    "Rotate the secret key? The current key stops working immediately.",
  "console.secretOnce":
    "Copy this secret now — it is shown only once. The server keeps only a hash.",
  "console.snippetLabel": "Tracking snippet",
  "console.snippetHelp":
    "Paste before </body> on the site you control. Tracking is optional — analyses work without it.",
  "console.lastEvent": "Last event",
  "console.noEvents": "No events received yet",
  "console.deleteSite": "Delete site",
  "console.deleteConfirm":
    "Delete this site? Scans are kept and return to Unassigned; the keys stop working.",
  "console.copy": "Copy",
  "console.newSiteTitle": "Add a site",
  "console.newSiteSub":
    "Register any URL — yours or a competitor's. No verification needed; you only ever see your own data.",
  "console.urlLabel": "Site URL",
  "console.create": "Register",
  "console.creating": "Registering…",
  "console.goToSite": "Go to site →",
  "console.copiedSecret": "Secret copied",

  "me.title": "My Page",
  "me.points": "Points",
  "me.credits": "Credits",
  "me.policyPending": "Withdrawal / conversion policy coming soon",
  "me.creditNote": "Spent on scans · earned at signup",
  "me.recentActivity": "Recent activity",
  "me.pointsHistory": "Point history",
  "me.creditHistory": "Credit history",
  "me.noPoints": "No point activity yet — answer surveys to earn points.",
  "me.noCredits": "No credit activity yet.",
  "me.myResponses": "My survey responses",
  "me.wallet": "Wallet",
  "me.viewAll": "View all",
  "me.date": "Date",
  "me.reason": "Reason",
  "me.source": "Source",
  "me.amount": "Amount",
  "me.taglineTester": "Your evaluations make the AI personas more accurate.",
} as const;

export type MessageKey = keyof typeof en;

const ko: Record<MessageKey, string> = {
  "nav.console": "콘솔",
  "nav.myPage": "마이페이지",
  "nav.signIn": "로그인",
  "nav.signOut": "로그아웃",

  "common.loading": "불러오는 중…",
  "common.back": "뒤로",
  "common.home": "홈",
  "common.signInTitle": "로그인이 필요합니다",
  "common.signInBody": "가입하면 $30 크레딧 — 약 15회 스캔이 무료입니다.",
  "common.retry": "다시 시도",

  "console.title": "사이트",
  "console.subtitle": "내 분석을 사이트 단위로 모아 봅니다.",
  "console.newAnalysis": "+ 새 분석",
  "console.creditsLeft": "크레딧 남음",
  "console.scansUnit": "회 스캔",
  "console.lastScan": "마지막 스캔",
  "console.emptyTitle":
    "URL을 넣으면 약 3분 뒤, 112명의 AI 페르소나가 누가 당신의 고객인지 알려줍니다.",
  "console.emptySub": "$30 웰컴 크레딧으로 약 15회 스캔이 무료입니다.",
  "console.emptyCta": "첫 분석 돌리기",
  "console.bestFit": "베스트 핏 고객층",
  "console.misfit": "미스핏",
  "console.overview": "개요",
  "console.reports": "리포트",
  "console.rescan": "재스캔",
  "console.scanHistory": "스캔 히스토리",
  "console.surveyResponses": "설문 응답",
  "console.humanCompared": "휴먼 비교 완료",
  "console.copySurveyLink": "설문 링크 복사",
  "console.copied": "복사됨!",
  "console.compareRun": "휴먼 비교 실행",
  "console.openReport": "리포트",
  "console.openCompare": "AI vs Human",
  "console.shareMd": "report.md",
  "console.publicNote": "리포트는 링크를 아는 사람 누구나 볼 수 있습니다 (unlisted).",
  "console.insufficient": "크레딧이 부족합니다",
  "console.date": "일시",
  "console.mode": "모드",
  "console.score": "점수",
  "console.personas": "페르소나",
  "console.status": "상태",
  "console.noCompleted": "이 사이트의 완료된 스캔이 아직 없습니다.",
  "console.addSite": "+ 사이트 추가",
  "console.unassigned": "미연결 스캔",
  "console.unassignedSub": "아직 사이트에 연결되지 않은 스캔입니다.",
  "console.registerAsSite": "사이트로 등록",
  "console.settings": "설정",
  "console.siteName": "사이트 이름",
  "console.save": "저장",
  "console.saved": "저장됨",
  "console.siteKeyLabel": "Site key (공개)",
  "console.secretLabel": "Secret key (서버 전용)",
  "console.rotate": "재발급",
  "console.rotateConfirm":
    "Secret key를 재발급할까요? 기존 키는 즉시 무효화됩니다.",
  "console.secretOnce":
    "이 secret은 지금 한 번만 표시됩니다 — 복사해 두세요. 서버에는 해시만 저장됩니다.",
  "console.snippetLabel": "트래킹 스니펫",
  "console.snippetHelp":
    "코드를 넣을 수 있는 사이트라면 </body> 앞에 붙여 넣으세요. 트래킹은 선택입니다 — 없어도 분석은 동작합니다.",
  "console.lastEvent": "마지막 이벤트",
  "console.noEvents": "아직 수신된 이벤트가 없습니다",
  "console.deleteSite": "사이트 삭제",
  "console.deleteConfirm":
    "이 사이트를 삭제할까요? 스캔은 보존되어 미연결로 돌아가고, 키는 즉시 무효화됩니다.",
  "console.copy": "복사",
  "console.newSiteTitle": "사이트 추가",
  "console.newSiteSub":
    "어떤 URL이든 등록할 수 있습니다 — 내 사이트든 경쟁사든. 검증 절차는 없고, 보이는 건 항상 내 데이터뿐입니다.",
  "console.urlLabel": "사이트 URL",
  "console.create": "등록",
  "console.creating": "등록 중…",
  "console.goToSite": "사이트로 이동 →",
  "console.copiedSecret": "Secret 복사됨",

  "me.title": "마이페이지",
  "me.points": "포인트",
  "me.credits": "크레딧",
  "me.policyPending": "출금·전환 정책 준비 중",
  "me.creditNote": "스캔에 사용 · 가입 시 지급",
  "me.recentActivity": "최근 활동",
  "me.pointsHistory": "포인트 내역",
  "me.creditHistory": "크레딧 내역",
  "me.noPoints": "포인트 내역이 아직 없습니다 — 설문에 응답하면 적립됩니다.",
  "me.noCredits": "크레딧 내역이 아직 없습니다.",
  "me.myResponses": "내 설문 이력",
  "me.wallet": "지갑",
  "me.viewAll": "전체 보기",
  "me.date": "일시",
  "me.reason": "사유",
  "me.source": "출처",
  "me.amount": "금액",
  "me.taglineTester": "당신의 평가가 AI 페르소나를 더 정확하게 만듭니다.",
};

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, ko };

type I18nValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nValue>({
  locale: "en",
  setLocale: () => {},
  t: (key) => en[key],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // localStorage read happens post-hydration so SSR markup (always
  // "en") matches the first client render — no hydration mismatch.
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "ko" || saved === "en") setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode — locale just won't persist */
    }
  };

  const t = (key: MessageKey) => MESSAGES[locale][key] ?? en[key];

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
