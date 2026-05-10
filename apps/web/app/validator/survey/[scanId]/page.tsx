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
import { meApi, scanApi, type CustomQuestion } from "@/lib/api";
import { C, FM, FS, Frame } from "../../_components/ui";

const SUS_QUESTIONS = [
  "I think that I would like to use this site frequently.",
  "I found the site unnecessarily complex.",
  "I thought the site was easy to use.",
  "I think I would need help to use this site.",
  "I found the various functions in this site were well integrated.",
  "I thought there was too much inconsistency in this site.",
  "I would imagine that most people would learn to use this site quickly.",
  "I found the site very cumbersome to use.",
  "I felt very confident using the site.",
  "I needed to learn a lot before I could get going with this site.",
];

const ENGAGEMENT_OPTIONS = [
  { id: "abandon", label: "Abandon (<15s)" },
  { id: "skim", label: "Skim (<1min)" },
  { id: "browse", label: "Browse (1-5min)" },
  { id: "engage", label: "Engage (5-15min)" },
  { id: "extended", label: "Extended (>15min)" },
] as const;

const RETENTION_OPTIONS = [
  { id: "no_return", label: "No return" },
  { id: "weak", label: "Weak — maybe once" },
  { id: "moderate", label: "Moderate — weekly" },
  { id: "strong", label: "Strong — daily" },
] as const;

const AGE_OPTIONS = [
  { id: "teen", label: "<20" },
  { id: "young_adult", label: "20s" },
  { id: "adult", label: "30-40s" },
  { id: "senior", label: "50+" },
] as const;

export default function SurveyPage() {
  const params = useParams<{ scanId: string }>();
  const scanId = params?.scanId ?? "";
  const { ready, authenticated, login } = usePrivy();

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
  const [success, setSuccess] = useState<{ delta: Record<string, number> } | null>(null);
  const [hasPriorSubmission, setHasPriorSubmission] = useState(false);

  // Phase 5 — site-specific custom questions, loaded once on mount.
  // Null while loading, [] when the scan has none, populated otherwise.
  const [customQuestions, setCustomQuestions] = useState<CustomQuestion[] | null>(null);
  const [customAnswers, setCustomAnswers] = useState<Record<string, number | string>>({});

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
    if (!authenticated) {
      if (ready) login();
      return;
    }
    setError(null); setSubmitting(true);
    try {
      const r = await scanApi.submitSurvey(scanId, {
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
      });
      setSuccess({ delta: r.summary.delta });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <Frame active="discovery">
        <div className="v-page-pad" style={{ maxWidth: 640, margin: "0 auto" }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, fontFamily: FS, marginBottom: 14 }}>
            ✓ Thanks — your response was recorded.
          </h1>
          <div style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, marginBottom: 24 }}>
            5 calibration rows written (one per dimension). The team uses these to
            measure how closely the AI personas match real human reactions.
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
            <div style={{ marginBottom: 8, color: C.textDim }}>LLM vs You (Δ per dimension)</div>
            {Object.entries(success.delta).map(([dim, d]) => (
              <div key={dim} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span>{dim}</span>
                <span style={{ color: Math.abs(d) < 10 ? C.ok : Math.abs(d) < 25 ? C.warn : C.bad }}>
                  {d > 0 ? "+" : ""}{d.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
          <Link href="/" style={{ color: C.accent, fontSize: 13, textDecoration: "none" }}>
            ← Back to home
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
            ← Home
          </Link>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 600, fontFamily: FS, lineHeight: 1.2, marginBottom: 8 }}>
          Human calibration survey
        </h1>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 4 }}>
          Scan ID: <span style={{ fontFamily: FM, color: C.text }}>{scanId.slice(0, 8)}…</span>
        </div>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 30, lineHeight: 1.6 }}>
          Use the site for a few minutes, then answer below. Your responses become
          ground-truth for measuring AI persona accuracy.
        </div>

        {/* Auth gate — Phase 5.1 replaces the email field. Anyone can
            view the form, but Submit triggers Privy login if needed.
            When the user has a prior submission, show the "you're
            editing your previous answer" banner. */}
        {ready && !authenticated && (
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
            Sign in to submit your survey. Your responses are tied to your
            account so you can come back and edit them later.
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
              Sign in →
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
            ✎ You&rsquo;ve submitted before — editing your previous answer.
            Resubmitting overwrites it.
          </div>
        )}

        {/* SUS-10 */}
        <Section title="Usability (SUS-10)" sub="Strongly disagree (1) → Strongly agree (5)">
          {SUS_QUESTIONS.map((q, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: C.textFaint, fontFamily: FM, marginRight: 6 }}>Q{i + 1}.</span>
                {q}
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
        <Section title="Engagement" sub="Roughly how long would you spend on this site?">
          <RadioRow options={ENGAGEMENT_OPTIONS} value={engagement} onChange={setEngagement} />
        </Section>

        {/* Adoption */}
        <Section title="Adoption" sub="How likely are you to sign up / start using this?">
          <Slider value={signupLikelihood} onChange={setSignupLikelihood} suffix="%" />
        </Section>

        {/* Retention */}
        <Section title="Retention" sub="Would you come back?">
          <RadioRow options={RETENTION_OPTIONS} value={retention} onChange={setRetention} />
        </Section>

        {/* Task success */}
        <Section title="Task success" sub="How likely could you complete the site's core action?">
          <Slider value={completionLikelihood} onChange={setCompletionLikelihood} suffix="%" />
        </Section>

        {/* Voice quotes */}
        <Section title="Voice quotes" sub="Optional but valued — your voice goes into the report.">
          <Textarea label="First impression" value={firstImpression} onChange={setFirstImpression} />
          <Textarea label="Biggest friction" value={biggestFriction} onChange={setBiggestFriction} />
          <Textarea label="What would make you return" value={wouldReturnBecause} onChange={setWouldReturnBecause} />
          <Textarea label="One thing to change" value={oneThingToChange} onChange={setOneThingToChange} />
        </Section>

        {/* Site-specific questions — only render when the scan has them. */}
        {customQuestions && customQuestions.length > 0 && (
          <Section
            title="Site-specific questions"
            sub="Tailored to this site — your answers feed the comparison report."
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
                    placeholder="Type your answer here…"
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
        <Section title="About you" sub="For cohort matching only — not stored against your email.">
          <FieldRow label="Age">
            <RadioRow options={AGE_OPTIONS} value={ageGroup} onChange={setAgeGroup} />
          </FieldRow>
          <FieldRow label="Tech literacy">
            <Slider value={techLit} onChange={setTechLit} suffix="%" />
          </FieldRow>
          <FieldRow label="Crypto experience">
            <Slider value={cryptoExp} onChange={setCryptoExp} suffix="%" />
          </FieldRow>
          <FieldRow label="Primary device">
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { id: true, label: "Mobile" },
                { id: false, label: "Desktop" },
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
          {submitting ? "Submitting…" : "Submit response"}
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

