"use client";

import Link from "next/link";
import { C, FM, Frame, Pill } from "../_components/ui";

// Methodology page — the report numbers aren't a black box. Source
// of truth for every formula referenced here:
//   apps/api/src/services/audience_fit.ts
//   services/dimensions/llm.ts
//   services/cohort_selection.ts
//   services/aarrr.ts
// Update both when the math changes.
//
// Marked as a client component so it can dot into the `C` color
// constant exported from validator/_components/ui.tsx (which is
// "use client" itself). Server components can't dot into client
// modules — Next 14 RSC boundary rule.

export default function HowItWorks() {
  return (
    <Frame>
      <div className="v-page-pad" style={{ maxWidth: 820, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <Link
            href="/"
            style={{
              fontSize: 12,
              color: C.textFaint,
              fontFamily: FM,
              textDecoration: "none",
            }}
          >
            ← Home
          </Link>
        </div>

        <Pill tone="accent">Methodology</Pill>
        <h1
          style={{
            fontSize: "clamp(26px, 6vw, 38px)",
            fontWeight: 600,
            letterSpacing: "-0.025em",
            margin: "10px 0 8px",
            lineHeight: 1.2,
          }}
        >
          How the audience-fit score is calculated
        </h1>
        <p
          style={{
            fontSize: 15,
            color: C.textDim,
            lineHeight: 1.6,
            marginBottom: 32,
          }}
        >
          Every number on a report traces to a published formula on this page.
          No black box — if you can&apos;t reproduce a score from the persona
          responses below, that&apos;s a bug.
        </p>

        <Section n={0} title="What this measures (and doesn't)">
          <p
            style={{
              fontSize: 13,
              color: C.textDim,
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            41R is an <b>audience research panel</b> — 8 cohorts × 14 personas
            evaluate your site and report a structured reaction. It is{" "}
            <b>not a traffic predictor</b>. Read scores as a relative ranking
            tool, not a forecast of how many real visitors will convert.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
              marginTop: 12,
            }}
          >
            <div
              style={{
                padding: 14,
                border: `1px solid ${C.ok}33`,
                background: C.okSoft,
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontFamily: FM,
                  color: C.ok,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}
              >
                ✓ MEASURES
              </div>
              <ul
                style={{
                  paddingLeft: 18,
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.65,
                  color: C.text,
                }}
              >
                <li>Engaged-audience reactions per cohort</li>
                <li>Cohort fit ranking (which audience resonates)</li>
                <li>Friction quality + voice quotes</li>
                <li>5-dimension breakdown per cohort</li>
                <li>Relative comparison across sites</li>
              </ul>
            </div>
            <div
              style={{
                padding: 14,
                border: `1px solid ${C.bad}33`,
                background: C.badSoft,
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontFamily: FM,
                  color: C.bad,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}
              >
                ✗ DOES NOT MEASURE
              </div>
              <ul
                style={{
                  paddingLeft: 18,
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.65,
                  color: C.text,
                }}
              >
                <li>Traffic acquisition / bounce rate</li>
                <li>Real conversion rate (intent ≠ action; ~10× gap)</li>
                <li>Visitor-level AARRR funnel numbers</li>
                <li>What % of all visitors will abandon</li>
                <li>Channel attribution / SEO performance</li>
              </ul>
            </div>
          </div>
          <p
            style={{
              fontSize: 12,
              color: C.textFaint,
              marginTop: 12,
              lineHeight: 1.55,
            }}
          >
            <b style={{ color: C.text }}>Acquisition Layer v1.1 — live.</b>{" "}
            The report page now ships a toggle between the research-panel
            view (persona-conditional) and the visitor-weighted view
            (priors-weighted by 12 site categories × 8 cohorts). Numerical
            calibration n=1 baseline against Google Merch Store: AARRR
            activation gap halved, 95% → 49% (GA4 reality 23%).
          </p>
        </Section>

        <Section n={1} title="Two analysis modes">
          <Row label="Discovery (Mode A)">
            URL only. <b>112 personas across 8 standard cohorts</b> (14 each)
            react. Output: a 4-component composite + cohort × dimension
            breakdown. Use when you want to find <i>who</i> your audience is.
          </Row>
          <Row label="Verify audience (Mode B)">
            URL + audience text (e.g.{" "}
            <Mono>&quot;30s DeFi expert mobile-first&quot;</Mono>). Haiku parses
            the text into a cohort selector; up to 50 matching personas run a
            single-bucket pass / conditional / fail check. Use when you already{" "}
            <i>know</i> the audience and want a verdict.
          </Row>
        </Section>

        <Section n={2} title="Five measurement dimensions">
          <p
            style={{
              fontSize: 13,
              color: C.textDim,
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            Each persona reports on five dimensions after viewing the site.
            Raw inputs are converted to a 0–100 score using these rules:
          </p>
          <DimRow
            name="Engagement"
            input="Engagement band (5 levels by predicted session length)"
            formula="ENGAGEMENT_BAND_TO_SCORE lookup"
          >
            <BandTable
              header={["Band", "Session", "Score"]}
              rows={[
                ["abandon", "< 15s", "10"],
                ["skim", "< 1 min", "30"],
                ["browse", "1 – 5 min", "55"],
                ["engage", "5 – 15 min", "75"],
                ["extended", "> 15 min", "90"],
              ]}
            />
          </DimRow>
          <DimRow
            name="Task Success"
            input="completion_likelihood (0–1)"
            formula="completion_likelihood × 100"
          />
          <DimRow
            name="Happiness"
            input="10-item SUS questionnaire (1–5 Likert)"
            formula="computeSusScore(responses) — standard SUS formula"
          />
          <DimRow
            name="Adoption"
            input="signup_likelihood (0–1)"
            formula="signup_likelihood × 100"
          />
          <DimRow
            name="Retention D-7"
            input="Retention band (4 levels) — D-7 read off a deterministic D-curve"
            formula="RETENTION_BAND_TO_DCURVE[band].d7"
          >
            <BandTable
              header={["Band", "D-1", "D-3", "D-7", "D-30"]}
              rows={[
                ["no_return", "5", "1", "0", "0"],
                ["weak", "40", "15", "5", "1"],
                ["moderate", "70", "50", "30", "10"],
                ["strong", "85", "70", "55", "30"],
              ]}
            />
          </DimRow>
        </Section>

        <Section n={3} title="Cohort fit score (per cohort)">
          <p
            style={{
              fontSize: 13,
              color: C.textDim,
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            Within each cohort the dimension scores are arithmetic-averaged
            across non-flagged personas, then combined with these weights
            (DIMENSION_WEIGHTS_V1):
          </p>
          <FormulaBlock>
            cohort_fit = <Term>0.30</Term> · engagement +{" "}
            <Term>0.30</Term> · task_success + <Term>0.25</Term> · happiness +{" "}
            <Term>0.10</Term> · adoption + <Term>0.05</Term> · retention_d7
          </FormulaBlock>
          <p
            style={{
              fontSize: 12,
              color: C.textFaint,
              marginTop: 10,
              lineHeight: 1.5,
            }}
          >
            Weights reflect signal strength. Calibration shows engagement +
            task_success have the strongest correlation with real ground-truth
            outcomes; retention_d7 is the weakest signal so it carries 5%.
          </p>
        </Section>

        <Section n={4} title="Audience-fit score (top-line)">
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: C.text,
                marginBottom: 6,
              }}
            >
              Mode A — Discovery composite
            </div>
            <FormulaBlock>
              audience_fit = <Term>0.40</Term> · best_cohort +{" "}
              <Term>0.30</Term> · median_cohort +{" "}
              <Term>0.20</Term> · global_task_success +{" "}
              <Term>0.10</Term> · global_sentiment
            </FormulaBlock>
            <ul
              style={{
                fontSize: 12,
                color: C.textDim,
                marginTop: 10,
                paddingLeft: 18,
                lineHeight: 1.55,
              }}
            >
              <li>
                <Mono>best_cohort</Mono> — highest cohort_fit among the 8
              </li>
              <li>
                <Mono>median_cohort</Mono> — median of the 8 cohort_fit values
                (4th–5th ranked, averaged when even)
              </li>
              <li>
                <Mono>global_task_success</Mono> — arithmetic mean of every
                non-flagged persona&apos;s task_success
              </li>
              <li>
                <Mono>global_sentiment</Mono> — arithmetic mean of every
                non-flagged persona&apos;s happiness
              </li>
            </ul>
            <p
              style={{
                fontSize: 12,
                color: C.textFaint,
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              Rewards finding any cohort that resonates strongly (best · 0.4)
              while keeping the rest of the audience honest via median + two
              global signals.
            </p>
          </div>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: C.text,
                marginBottom: 6,
              }}
            >
              Mode B — Verification (single bucket)
            </div>
            <FormulaBlock>
              audience_fit = cohort_fit (one bucket only)
            </FormulaBlock>
            <p
              style={{
                fontSize: 12,
                color: C.textFaint,
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              Mode B has only the parsed-audience bucket, so best / median /
              worst all collapse to the same value. The composite weights
              don&apos;t apply.
            </p>
          </div>
        </Section>

        <Section n={5} title="8 standard cohorts (Mode A)">
          <p
            style={{
              fontSize: 13,
              color: C.textDim,
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            Mode A samples ~14 personas from each of these 8 cohorts (~112
            total) drawn from a 800-persona pool. Selection is deterministic —
            the same scanId always picks the same personas.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 8,
            }}
          >
            {COHORTS.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: "10px 12px",
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontFamily: FM,
                    color: C.textFaint,
                    marginBottom: 2,
                  }}
                >
                  {c.id}
                </div>
                <div
                  style={{ fontSize: 13, color: C.text, fontWeight: 500 }}
                >
                  {c.label}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section n={6} title="Verdict thresholds (Mode B)">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 10,
            }}
          >
            <VerdictCard
              tone="ok"
              range="≥ 60"
              label="PASS"
              hint="Strong audience fit"
            />
            <VerdictCard
              tone="warn"
              range="40 – 60"
              label="CONDITIONAL"
              hint="Improvement needed"
            />
            <VerdictCard
              tone="bad"
              range="< 40"
              label="FAIL"
              hint="Critical churn risk"
            />
          </div>
        </Section>

        <Section n={7} title="AARRR funnel (Mode A)">
          <p
            style={{
              fontSize: 13,
              color: C.textDim,
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            Each stage is a <b>cumulative subset</b> of the previous one — a
            persona must pass every earlier threshold to be counted. This
            guarantees the funnel is monotonically non-increasing.
          </p>
          <Stage label="Acquisition" rule="Reached the URL (baseline = 100%)" />
          <Stage label="Activation" rule="+ task_success ≥ 30" />
          <Stage label="Retention" rule="+ retention_d7 ≥ 5" />
          <Stage label="Referral" rule="+ happiness ≥ 60" />
          <Stage label="Revenue" rule="+ adoption ≥ 30" />
          <p
            style={{
              fontSize: 12,
              color: C.textFaint,
              marginTop: 14,
              lineHeight: 1.55,
            }}
          >
            Threshold values (30 / 5 / 60 / 30) are <b>v1.1 baselines</b> —
            re-tuned 2026-05-06 from the original v1.0 (30 / 30 / 60 / 65)
            after observing the persona output distribution: ~85% of
            personas land in the &ldquo;weak&rdquo; retention band (D7=5),
            so the old retention ≥30 gate killed the funnel post-activation.
            Lowered retention to ≥5 (excludes only no_return) and revenue
            to ≥30 (matches realistic intent distribution). Per-category
            re-tuning still planned as Track A/B/C calibration data accrues.
          </p>
          <div
            style={{
              padding: "12px 14px",
              background: C.warnSoft,
              border: `1px solid ${C.warn}33`,
              borderRadius: 8,
              marginTop: 14,
              fontSize: 12,
              color: C.text,
              lineHeight: 1.6,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontFamily: FM,
                color: C.warn,
                fontWeight: 600,
                letterSpacing: "0.06em",
                marginBottom: 4,
              }}
            >
              ⚠ NOT A REAL VISITOR FUNNEL
            </div>
            These percentages reflect <b>persona-conditional behavior</b> —
            i.e. <i>&ldquo;IF this persona reaches the site AND engages,
            what % pass each gate?&rdquo;</i>. Real visitor-level AARRR
            (with the abandon population included) requires the Acquisition
            Layer (v1.1, in progress). Until then, treat absolute % as
            relative ranking signal between sites, not a traffic forecast.
          </div>
        </Section>

        <Section n={8} title="Friction clustering">
          <p style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6 }}>
            Personas leave free-text comments about what blocked them. Haiku
            reads all comments at once and clusters semantically equivalent
            complaints into N themes (e.g. &ldquo;cluttered navigation&rdquo;
            subsumes &ldquo;menu is hard to find&rdquo; + &ldquo;can&apos;t
            locate settings&rdquo;). Each cluster on the report shows: rank ·
            short title · n personas · representative quote · estimated
            fit-score impact if resolved.
          </p>
          <p
            style={{
              fontSize: 12,
              color: C.textFaint,
              marginTop: 10,
              lineHeight: 1.5,
            }}
          >
            Long-tail invariant: cluster <Mono>n</Mono> sum +
            &ldquo;Other&rdquo; bucket equals total comments. Friction inputs
            are never silently dropped.
          </p>
        </Section>

        <Section n={9} title="Calibration & confidence">
          <p
            style={{
              fontSize: 13,
              color: C.textDim,
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            Calibration measures how well LLM persona estimates match real
            outcomes via per-dimension Pearson correlation:
          </p>
          <table
            style={{
              width: "100%",
              fontSize: 12,
              borderCollapse: "collapse",
              marginTop: 4,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${C.border}`,
                  color: C.textFaint,
                  fontFamily: FM,
                }}
              >
                <th style={{ textAlign: "left", padding: "6px 0" }}>r value</th>
                <th style={{ textAlign: "left", padding: "6px 0" }}>
                  Confidence
                </th>
                <th style={{ textAlign: "left", padding: "6px 0" }}>Reading</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 0", fontFamily: FM }}>≥ 0.7</td>
                <td
                  style={{
                    padding: "8px 0",
                    color: C.ok,
                    fontWeight: 600,
                  }}
                >
                  High
                </td>
                <td style={{ padding: "8px 0", color: C.textDim }}>
                  Strong agreement with ground truth
                </td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 0", fontFamily: FM }}>0.4 – 0.7</td>
                <td
                  style={{
                    padding: "8px 0",
                    color: C.warn,
                    fontWeight: 600,
                  }}
                >
                  Medium
                </td>
                <td style={{ padding: "8px 0", color: C.textDim }}>
                  Useful directional signal
                </td>
              </tr>
              <tr>
                <td style={{ padding: "8px 0", fontFamily: FM }}>&lt; 0.4</td>
                <td
                  style={{
                    padding: "8px 0",
                    color: C.bad,
                    fontWeight: 600,
                  }}
                >
                  Low
                </td>
                <td style={{ padding: "8px 0", color: C.textDim }}>
                  Still calibrating — interpret with care
                </td>
              </tr>
            </tbody>
          </table>
          <p
            style={{
              fontSize: 12,
              color: C.textFaint,
              marginTop: 14,
              lineHeight: 1.5,
            }}
          >
            Three calibration tracks feed this: <b>Track A</b> (automated
            stagehand runs against benchmark sites), <b>Track B</b> (human
            baseline surveys submitted from report screens), and{" "}
            <b>Track C</b> (third-party analytics overlays). Full report at{" "}
            <Link
              href="/validator/calibration"
              style={{ color: C.accent, textDecoration: "underline" }}
            >
              /validator/calibration
            </Link>
            .
          </p>
        </Section>

        <Section n={10} title="Honesty contract">
          <ul
            style={{
              paddingLeft: 20,
              margin: 0,
              fontSize: 13,
              color: C.textDim,
              lineHeight: 1.7,
            }}
          >
            <li>
              <b>Synthetic personas are labelled.</b> The 800-persona pool is
              clearly synthetic; cards display a &ldquo;synth&rdquo; marker
              when pool names are used.
            </li>
            <li>
              <b>Flagged personas excluded.</b> Personas whose responses fail
              validation (LLM JSON malformed, contradictory answers) are
              excluded from cohort means and counted separately.
            </li>
            <li>
              <b>n alongside every average.</b> Each cohort exposes
              n_completed and n_target — small samples are not hidden.
            </li>
            <li>
              <b>Friction long-tail preserved.</b> Comments that don&apos;t fit
              a cluster are gathered in an &ldquo;Other&rdquo; bucket rather
              than silently dropped.
            </li>
            <li>
              <b>Audit-grounded findings.</b> Diagnosis claims must cite
              specific persona reports — unverifiable claims surface as
              warnings.
            </li>
          </ul>
        </Section>

        <div
          style={{
            marginTop: 48,
            padding: "20px 0",
            borderTop: `1px solid ${C.border}`,
            fontSize: 12,
            color: C.textFaint,
            fontFamily: FM,
            lineHeight: 1.6,
          }}
        >
          Source of truth: <Mono>apps/api/src/services/audience_fit.ts</Mono> ·{" "}
          <Mono>services/dimensions/llm.ts</Mono> ·{" "}
          <Mono>services/aarrr.ts</Mono>. Math invariants are locked by tests
          in <Mono>__tests__/audience_fit_helpers.test.ts</Mono>.
        </div>
      </div>
    </Frame>
  );
}

const COHORTS: { id: string; label: string }[] = [
  { id: "web3_pro", label: "Web3 power users (30s)" },
  { id: "defi_beginner", label: "DeFi beginners" },
  { id: "crypto_native", label: "Crypto natives" },
  { id: "designer_20s", label: "Designers (20s)" },
  { id: "mobile_power", label: "Mobile-first power users" },
  { id: "non_tech_30s", label: "Non-technical 30s" },
  { id: "teen_newcomer", label: "Teen newcomers" },
  { id: "senior", label: "Seniors (50+)" },
];

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 36 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 14,
          paddingBottom: 8,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
          {String(n).padStart(2, "0")}
        </span>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: FM,
          color: C.textFaint,
          letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
        {children}
      </div>
    </div>
  );
}

function DimRow({
  name,
  input,
  formula,
  children,
}: {
  name: string;
  input: string;
  formula: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 140px) minmax(0, 1fr)",
        gap: 16,
        padding: "10px 0",
        borderBottom: `1px solid ${C.border}`,
        alignItems: "baseline",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{name}</div>
      <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
        <div>
          <span style={{ color: C.textFaint, fontFamily: FM }}>input · </span>
          {input}
        </div>
        <div style={{ marginTop: 2 }}>
          <span style={{ color: C.textFaint, fontFamily: FM }}>formula · </span>
          <Mono>{formula}</Mono>
        </div>
        {children && <div style={{ marginTop: 8 }}>{children}</div>}
      </div>
    </div>
  );
}

function BandTable({
  header,
  rows,
}: {
  header: string[];
  rows: string[][];
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          fontSize: 11,
          borderCollapse: "collapse",
          fontFamily: FM,
          minWidth: 280,
        }}
      >
        <thead>
          <tr style={{ color: C.textFaint }}>
            {header.map((h, i) => (
              <th
                key={h}
                style={{
                  textAlign: i === 0 ? "left" : "right",
                  padding: "4px 10px 4px 0",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} style={{ borderTop: `1px solid ${C.border}` }}>
              {r.map((cell, i) => (
                <td
                  key={i}
                  style={{
                    textAlign: i === 0 ? "left" : "right",
                    padding: "4px 10px 4px 0",
                    color: i === 0 ? C.text : C.textDim,
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormulaBlock({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "#fff",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        fontSize: 13,
        fontFamily: FM,
        color: C.text,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: C.accent, fontWeight: 600 }}>{children}</span>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: FM, fontSize: "0.95em", color: C.text }}>
      {children}
    </span>
  );
}

function VerdictCard({
  tone,
  range,
  label,
  hint,
}: {
  tone: "ok" | "warn" | "bad";
  range: string;
  label: string;
  hint: string;
}) {
  const color = tone === "ok" ? C.ok : tone === "warn" ? C.warn : C.bad;
  const soft =
    tone === "ok" ? C.okSoft : tone === "warn" ? C.warnSoft : C.badSoft;
  return (
    <div
      style={{
        padding: "14px 16px",
        background: soft,
        border: `1px solid ${color}33`,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontFamily: FM,
          fontSize: 11,
          color,
          fontWeight: 600,
        }}
      >
        {range}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color,
          marginTop: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>{hint}</div>
    </div>
  );
}

function Stage({ label, rule }: { label: string; rule: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 130px) minmax(0, 1fr)",
        gap: 16,
        padding: "8px 0",
        borderBottom: `1px solid ${C.border}`,
        alignItems: "baseline",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}</div>
      <div style={{ fontSize: 12, color: C.textDim }}>
        <Mono>{rule}</Mono>
      </div>
    </div>
  );
}
