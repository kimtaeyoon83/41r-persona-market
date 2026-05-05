"use client";

// Human survey page — Phase 2 §D3 / P2-5.
//
// A human takes the same §11.1 survey the AI personas take for the
// same site. Submit → POST /api/scan/:id/survey → 5 calibration_records
// rows with source='human_baseline'. Track A aggregator picks them up.
//
// In Phase 2 the email field is just for traceability (no auth).
// Phase 4 promotes to Privy login.

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { scanApi } from "@/lib/api";
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

  const [email, setEmail] = useState("");
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

  const onSubmit = async () => {
    if (submitting) return;
    if (!email.trim()) { setError("Email required"); return; }
    setError(null); setSubmitting(true);
    try {
      const r = await scanApi.submitSurvey(scanId, {
        email: email.trim(),
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

        {/* Email */}
        <Section title="Your email" sub="For traceability only — no marketing.">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={inputStyle()}
          />
        </Section>

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

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 14px",
    fontSize: 13,
    fontFamily: FS,
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    outline: "none",
    color: C.text,
  };
}
