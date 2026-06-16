"use client";

// Human survey page — Phase 5.1.
//
// A human takes the same §11.1 survey the AI personas take for the
// same site. Submit → POST /api/scan/:id/survey upserts one row in
// survey_responses (keyed by user_id) AND appends 5 calibration_records
// rows for legacy operator aggregation.
//
// Phase 5.1 — Privy auth required. Identity comes from the JWT (no
// email field). On mount we fetch the user's prior submission (if any)
// and prefill the form so they can edit instead of starting from
// scratch.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { meApi, scanApi, submitSurveyByToken, type CustomQuestion } from "@/lib/api";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { C, FM, FS, Frame } from "../../_components/ui";

const ENGAGEMENT_IDS = ["abandon", "skim", "browse", "engage", "extended"] as const;
const RETENTION_IDS = ["no_return", "weak", "moderate", "strong"] as const;
const AGE_IDS = ["teen", "young_adult", "adult", "senior"] as const;

export default function SurveyPage() {
  const params = useParams<{ scanId: string }>();
  const scanId = params?.scanId ?? "";
  const { t } = useI18n();
  const engOptions = ENGAGEMENT_IDS.map((id) => ({ id, label: t(`survey.eng.${id}` as MessageKey) }));
  const retOptions = RETENTION_IDS.map((id) => ({ id, label: t(`survey.ret.${id}` as MessageKey) }));
  const ageOptions = AGE_IDS.map((id) => ({ id, label: t(`survey.age.${id}` as MessageKey) }));
  const { ready, authenticated, login } = usePrivy();

  // Partner handoff mode (geulbat pilot) — a signed `pt` token in the
  // query string replaces Privy auth entirely: identity is inside the
  // token, submit goes to the partner endpoint, and points are
  // credited to the partner email (claimable on later 41R login).
  // Read via window.location instead of useSearchParams() to avoid
  // the Next 14 Suspense-boundary requirement on static builds.
  const [partnerToken, setPartnerToken] = useState<string | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("pt");
    if (v) setPartnerToken(v);
  }, []);

  const [sus, setSus] = useState<number[]>(Array(10).fill(3));
  const [engagement, setEngagement] = useState<string>("browse");
  const [signupLikelihood, setSignupLikelihood] = useState(50);
  const [retention, setRetention] = useState<string>("weak");
  const [completionLikelihood, setCompletionLikelihood] = useState(50);
  const [firstImpression, setFirstImpression] = useState("");
  const [biggestFriction, setBiggestFriction] = useState("");
  const [wouldReturnBecause, setWouldReturnBecause] = useState("");
  const [oneThingToChange, setOneThingToChange] = useState("");
  const [ageGroup, setAgeGroup] = useState<string>("adult");
  const [techLit, setTechLit] = useState(60);
  const [cryptoExp, setCryptoExp] = useState(30);
  const [mobileFirst, setMobileFirst] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ delta?: Record<string, number>; points?: number } | null>(null);
  const [hasPriorSubmission, setHasPriorSubmission] = useState(false);

  // Phase 5 — site-specific custom questions, loaded once on mount.
  // Null while loading, [] when the scan has none, populated otherwise.
  const [customQuestions, setCustomQuestions] = useState<CustomQuestion[] | null>(null);
  const [customAnswers, setCustomAnswers] = useState<Record<string, number | string>>({});
  // Console S2 §12-7 — reward-cap state disclosed BEFORE answering.
  const [rewardAvailable, setRewardAvailable] = useState(true);

  // Load scan custom questions (always) + the user's prior response (if
  // authenticated) on mount. The prefill turns the page into an editor
  // instead of a blank form for users who already submitted.
  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    scanApi
      .getReport(scanId)
      .then((r) => {
        if (cancelled) return;
        setCustomQuestions(r.scan.custom_questions ?? []);
        setRewardAvailable(r.survey_reward_available ?? true);
      })
      .catch(() => {
        if (!cancelled) setCustomQuestions([]);
      });
    return () => { cancelled = true; };
  }, [scanId]);

  // Prefill from prior submission. Runs only after Privy reports authenticated.
  useEffect(() => {
    if (!scanId || !ready || !authenticated) return;
    let cancelled = false;
    meApi
      .getMySurveyResponse(scanId)
      .then((r) => {
        if (cancelled) return;
        setHasPriorSubmission(true);
        setSus(r.response.sus_responses);
        setEngagement(r.response.dimension_inputs.engagement_category);
        setSignupLikelihood(Math.round(r.response.dimension_inputs.signup_likelihood * 100));
        setRetention(r.response.dimension_inputs.retention_category);
        setCompletionLikelihood(Math.round(r.response.dimension_inputs.completion_likelihood * 100));
        setFirstImpression(r.response.voice.first_impression ?? "");
        setBiggestFriction(r.response.voice.biggest_friction ?? "");
        setWouldReturnBecause(r.response.voice.would_return_because ?? "");
        setOneThingToChange(r.response.voice.if_could_change_one_thing ?? "");
        setAgeGroup(r.response.demographics.age_group);
        setTechLit(Math.round(r.response.demographics.tech_literacy * 100));
        setCryptoExp(Math.round(r.response.demographics.crypto_experience * 100));
        setMobileFirst(r.response.demographics.mobile_first);
        setCustomAnswers(r.response.custom_answers ?? {});
      })
      .catch(() => {
        // 404 = first-time submission. Leave defaults.
        if (!cancelled) setHasPriorSubmission(false);
      });
    return () => { cancelled = true; };
  }, [scanId, ready, authenticated]);

  const onSubmit = async () => {
    if (submitting) return;
    if (!partnerToken && !authenticated) {
      if (ready) login();
      return;
    }
    setError(null); setSubmitting(true);
    const payload = {
      sus_responses: sus,
      engagement_category: engagement as "abandon" | "skim" | "browse" | "engage" | "extended",
      signup_likelihood: signupLikelihood / 100,
      retention_category: retention as "no_return" | "weak" | "moderate" | "strong",
      completion_likelihood: completionLikelihood / 100,
      voice: {
        first_impression: firstImpression,
        biggest_friction: biggestFriction,
        would_return_because: wouldReturnBecause,
        if_could_change_one_thing: oneThingToChange,
      },
      demographics: {
        age_group: ageGroup as "teen" | "young_adult" | "adult" | "senior",
        tech_literacy: techLit / 100,
        crypto_experience: cryptoExp / 100,
        mobile_first: mobileFirst,
      },
      custom_answers: customAnswers,
    };
    const doSubmit = async () => {
      if (partnerToken) {
        const r = await submitSurveyByToken(partnerToken, payload);
        return { points: r.points_awarded };
      }
      const r = await scanApi.submitSurvey(scanId, payload);
      return { delta: r.summary.delta };
    };
    try {
      let res: { points?: number; delta?: Record<string, number> };
      try {
        res = await doSubmit();
      } catch (e1) {
        // Re-submit is idempotent server-side (upsert keyed by
        // scan+identity), so a transient mobile network blip — where the
        // first request may have already saved but the response was lost
        // — self-heals on one retry. An expired/invalid token can't
        // recover, so don't retry that.
        const m1 = e1 instanceof Error ? e1.message : "";
        if (/expired|invalid_or_expired|token/i.test(m1)) throw e1;
        await new Promise((r) => setTimeout(r, 1500));
        res = await doSubmit();
      }
      setSuccess(res);
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      // Friendly, specific copy instead of a raw error code.
      const friendly = /expired|invalid_or_expired|token/i.test(m)
        ? t("survey.errExpired")
        : t("survey.errRetry");
      setError(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <Frame active="discovery">
        <div className="v-page-pad" style={{ maxWidth: 640, margin: "0 auto" }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, fontFamily: FS, marginBottom: 14 }}>
            {t("survey.thanks")}
          </h1>
          {success.points != null && success.points > 0 && (
            <div style={{ fontSize: 14, color: C.ok, marginBottom: 12 }}>
              +{success.points}P {t("survey.pointsCredited")}
            </div>
          )}
          <div style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, marginBottom: 24 }}>
            {t("survey.calibNote")}
          </div>
          <div
            style={{
              padding: 16,
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 12,
              fontFamily: FM,
              marginBottom: 20,
            }}
          >
            <div style={{ marginBottom: 8, color: C.textDim }}>{t("survey.llmVsYou")}</div>
            {Object.entries(success.delta ?? {}).map(([dim, d]) => (
              <div key={dim} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span>{dim}</span>
                <span style={{ color: Math.abs(d) < 10 ? C.ok : Math.abs(d) < 25 ? C.warn : C.bad }}>
                  {d > 0 ? "+" : ""}{d.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
          <Link href="/" style={{ color: C.accent, fontSize: 13, textDecoration: "none" }}>
            {t("survey.backHome")}
          </Link>
        </div>
      </Frame>
    );
  }

  return (
    <Frame active="discovery">
      <div className="v-page-pad" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <Link href="/" style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, textDecoration: "none" }}>
            {t("survey.home")}
          </Link>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 600, fontFamily: FS, lineHeight: 1.2, marginBottom: 8 }}>
          {t("survey.title")}
        </h1>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 4 }}>
          {t("survey.scanId")}: <span style={{ fontFamily: FM, color: C.text }}>{scanId.slice(0, 8)}…</span>
        </div>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 30, lineHeight: 1.6 }}>
          {t("survey.intro")}
        </div>

        {/* Console S2 — pre-answer reward disclosure (§12 decision 7:
            trust over response rate). Shown before any input so the
            respondent knows the point budget is exhausted up front. */}
        {!rewardAvailable && (
          <div
            style={{
              padding: 14,
              marginBottom: 20,
              background: C.warnSoft,
              border: `1px solid #ecdcb4`,
              borderRadius: 8,
              fontSize: 13,
              color: C.warn,
              lineHeight: 1.6,
            }}
          >
            {t("survey.rewardExhausted")}
          </div>
        )}

        {/* Auth gate — Phase 5.1 replaces the email field. Anyone can
            view the form, but Submit triggers Privy login if needed.
            When the user has a prior submission, show the "you're
            editing your previous answer" banner. */}
        {ready && !authenticated && !partnerToken && (
          <div
            style={{
              padding: 14,
              marginBottom: 20,
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 13,
              color: C.textDim,
              lineHeight: 1.6,
            }}
          >
            {t("survey.signInPrompt")}
            <button
              onClick={() => login()}
              style={{
                display: "inline-block",
                marginLeft: 10,
                padding: "6px 14px",
                fontSize: 12,
                fontFamily: FS,
                fontWeight: 500,
                background: C.text,
                color: C.bg,
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {t("survey.signIn")}
            </button>
          </div>
        )}
        {ready && authenticated && hasPriorSubmission && (
          <div
            style={{
              padding: 12,
              marginBottom: 20,
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 12,
              color: C.textDim,
            }}
          >
            {t("survey.editing")}
          </div>
        )}

        {/* SUS-10 */}
        <Section title={t("survey.susTitle")} sub={t("survey.susSub")}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: C.textFaint, fontFamily: FM, marginRight: 6 }}>Q{i + 1}.</span>
                {t(`survey.sus.${i + 1}` as MessageKey)}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      const next = [...sus];
                      next[i] = v;
                      setSus(next);
                    }}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      fontSize: 13,
                      fontFamily: FM,
                      background: sus[i] === v ? C.text : C.panel,
                      color: sus[i] === v ? C.bg : C.text,
                      border: `1px solid ${sus[i] === v ? C.text : C.border}`,
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Section>

        {/* Engagement */}
        <Section title={t("survey.engTitle")} sub={t("survey.engSub")}>
          <RadioRow options={engOptions} value={engagement} onChange={setEngagement} />
        </Section>

        {/* Adoption */}
        <Section title={t("survey.adoptTitle")} sub={t("survey.adoptSub")}>
          <Slider value={signupLikelihood} onChange={setSignupLikelihood} suffix="%" />
        </Section>

        {/* Retention */}
        <Section title={t("survey.retTitle")} sub={t("survey.retSub")}>
          <RadioRow options={retOptions} value={retention} onChange={setRetention} />
        </Section>

        {/* Task success */}
        <Section title={t("survey.taskTitle")} sub={t("survey.taskSub")}>
          <Slider value={completionLikelihood} onChange={setCompletionLikelihood} suffix="%" />
        </Section>

        {/* Voice quotes */}
        <Section title={t("survey.voiceTitle")} sub={t("survey.voiceSub")}>
          <Textarea label={t("survey.voiceFirst")} value={firstImpression} onChange={setFirstImpression} />
          <Textarea label={t("survey.voiceFriction")} value={biggestFriction} onChange={setBiggestFriction} />
          <Textarea label={t("survey.voiceReturn")} value={wouldReturnBecause} onChange={setWouldReturnBecause} />
          <Textarea label={t("survey.voiceChange")} value={oneThingToChange} onChange={setOneThingToChange} />
        </Section>

        {/* Site-specific questions — only render when the scan has them. */}
        {customQuestions && customQuestions.length > 0 && (
          <Section
            title={t("survey.customTitle")}
            sub={t("survey.customSub")}
          >
            {customQuestions.map((q) => (
              <div key={q.id} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: C.textFaint, fontFamily: FM, marginRight: 6 }}>
                    {q.id.toUpperCase()}.
                  </span>
                  {q.question}
                </div>
                {q.type === "likert" ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    {[1, 2, 3, 4, 5].map((v) => {
                      const selected = customAnswers[q.id] === v;
                      return (
                        <button
                          key={v}
                          onClick={() =>
                            setCustomAnswers((a) => ({ ...a, [q.id]: v }))
                          }
                          style={{
                            flex: 1,
                            padding: "10px 0",
                            fontSize: 13,
                            fontFamily: FM,
                            background: selected ? C.text : C.panel,
                            color: selected ? C.bg : C.text,
                            border: `1px solid ${selected ? C.text : C.border}`,
                            borderRadius: 6,
                            cursor: "pointer",
                          }}
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <textarea
                    value={(customAnswers[q.id] as string) ?? ""}
                    onChange={(e) =>
                      setCustomAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                    rows={3}
                    placeholder={t("survey.typeAnswer")}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      fontSize: 13,
                      fontFamily: FS,
                      // Explicit color — without it, text inherits the
                      // page-level color set by html.dark class and
                      // renders white on white background (invisible).
                      color: C.text,
                      background: "#fff",
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      resize: "vertical",
                      outline: "none",
                    }}
                  />
                )}
              </div>
            ))}
          </Section>
        )}

        {/* Demographics */}
        <Section title={t("survey.aboutTitle")} sub={t("survey.aboutSub")}>
          <FieldRow label={t("survey.age")}>
            <RadioRow options={ageOptions} value={ageGroup} onChange={setAgeGroup} />
          </FieldRow>
          <FieldRow label={t("survey.tech")}>
            <Slider value={techLit} onChange={setTechLit} suffix="%" />
          </FieldRow>
          <FieldRow label={t("survey.crypto")}>
            <Slider value={cryptoExp} onChange={setCryptoExp} suffix="%" />
          </FieldRow>
          <FieldRow label={t("survey.device")}>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { id: true, label: t("survey.mobile") },
                { id: false, label: t("survey.desktop") },
              ].map((o) => (
                <button
                  key={String(o.id)}
                  onClick={() => setMobileFirst(o.id)}
                  style={{
                    padding: "8px 14px",
                    fontSize: 12,
                    fontFamily: FM,
                    background: mobileFirst === o.id ? C.text : C.panel,
                    color: mobileFirst === o.id ? C.bg : C.text,
                    border: `1px solid ${mobileFirst === o.id ? C.text : C.border}`,
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </FieldRow>
        </Section>

        {error && (
          <div style={{ color: C.bad, fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        <button
          onClick={onSubmit}
          disabled={submitting}
          style={{
            width: "100%",
            padding: "14px 24px",
            fontSize: 14,
            fontWeight: 600,
            background: C.text,
            color: C.bg,
            border: "none",
            borderRadius: 8,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.6 : 1,
            fontFamily: FS,
          }}
        >
          {submitting ? t("survey.submitting") : t("survey.submit")}
        </button>
      </div>
    </Frame>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 28,
        padding: 18,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: sub ? 4 : 12 }}>{title}</div>
      {sub && (
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12, fontFamily: FM }}>{sub}</div>
      )}
      {children}
    </div>
  );
}

function RadioRow({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ id: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: "8px 14px",
            fontSize: 12,
            fontFamily: FM,
            background: value === o.id ? C.text : "#fff",
            color: value === o.id ? C.bg : C.text,
            border: `1px solid ${value === o.id ? C.text : C.border}`,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  value,
  onChange,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <div style={{ fontSize: 13, fontFamily: FM, minWidth: 50, textAlign: "right" }}>
        {value}{suffix ?? ""}
      </div>
    </div>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4, fontFamily: FM }}>{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: 13,
          fontFamily: FS,
          // Explicit color — page-level html.dark would make typed text
          // white on this white background (invisible) without it.
          color: C.text,
          background: "#fff",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          resize: "vertical",
          outline: "none",
        }}
      />
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6, fontFamily: FM }}>{label}</div>
      {children}
    </div>
  );
}

