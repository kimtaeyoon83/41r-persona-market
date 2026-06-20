"use client";

// /proof — judge-facing on-chain provenance showcase. Top: the full pipeline
// flow diagram (how a record is built). Below: LIVE data from the most-anchored
// scan — report integrity + a grid of anchored personas; click one to drill into
// the whole vertical (plaintext → Seal ciphertext → public Walrus manifest JSON →
// Sui object.memwal_refs → how this persona's scores feed the report).
//
// Honesty contract (CLAUDE.md chain reality-check): sealed bytes are GATED (never
// claimed readable), reports have NO Sui object (DB hash only), personas are
// operator-owned synthetic seeds. The page says all of this in copy.

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import {
  scanApi,
  type ChainShowcase,
  type PersonaProof,
  type ShowcasePersona,
} from "@/lib/api";
import { C, Card, FM, FS, Frame } from "../validator/_components/ui";

async function browserSha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const label: React.CSSProperties = {
  fontSize: 10,
  color: C.textFaint,
  marginBottom: 3,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const mono: React.CSSProperties = {
  fontFamily: FM,
  fontSize: 12,
  color: C.text,
  wordBreak: "break-all",
};

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...mono, color: C.accent, textDecoration: "none" }}
    >
      {children}
    </a>
  );
}

// ─── Flow diagram ────────────────────────────────────────────────────────────

function Node({
  title,
  lines,
  tone = "neutral",
}: {
  title: string;
  lines: { k: string; v: string }[];
  tone?: "neutral" | "chain" | "walrus" | "gated";
}) {
  const toneMap = {
    neutral: { bd: C.border, accent: C.textDim, bg: C.panel },
    chain: { bd: "#f5cdb6", accent: C.accent, bg: "#fff8f3" },
    walrus: { bd: "#bcd5e8", accent: "#2c6e9b", bg: "#f4f9fc" },
    gated: { bd: "#ecdcab", accent: C.warn, bg: C.warnSoft },
  }[tone];
  return (
    <div
      style={{
        border: `1px solid ${toneMap.bd}`,
        background: toneMap.bg,
        borderRadius: 8,
        padding: "10px 12px",
        minWidth: 150,
        flex: "1 1 150px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: toneMap.accent,
          marginBottom: 6,
          fontFamily: FS,
          letterSpacing: "0.02em",
        }}
      >
        {title}
      </div>
      {lines.map((l) => (
        <div key={l.k} style={{ marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: C.textFaint, textTransform: "uppercase" }}>
            {l.k}
          </span>
          <div style={{ fontSize: 11, color: C.text, lineHeight: 1.35 }}>{l.v}</div>
        </div>
      ))}
    </div>
  );
}

function Arrow({ label: lbl }: { label?: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: C.textFaint,
        padding: "0 2px",
        minWidth: 28,
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>→</span>
      {lbl && (
        <span style={{ fontSize: 8, color: C.textFaint, textAlign: "center", marginTop: 2 }}>
          {lbl}
        </span>
      )}
    </div>
  );
}

function FlowDiagram() {
  return (
    <Card padding={16}>
      <div
        style={{
          fontSize: 11,
          color: C.accent,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
          fontWeight: 700,
          fontFamily: FS,
        }}
      >
        How a record is built — Sui + Walrus + Seal
      </div>
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 14, lineHeight: 1.5 }}>
        Each AI persona&apos;s memory becomes a tamper-evident on-chain record. The
        plaintext is sealed onto Walrus; a public sha256 manifest commits its
        content; the Sui object links both. Personas aggregate into a report with
        its own integrity hash.
      </div>

      {/* Row 1 — persona record */}
      <div style={{ fontSize: 10, color: C.textFaint, marginBottom: 6, fontWeight: 600 }}>
        PER PERSONA
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 4 }}>
        <Node
          title="Persona vector"
          tone="neutral"
          lines={[{ k: "plaintext", v: "behavioral memory JSON" }]}
        />
        <Arrow label="Seal" />
        <Node
          title="Walrus blob"
          tone="gated"
          lines={[{ k: "sealed", v: "ciphertext · gated" }]}
        />
        <Arrow label="sha256" />
        <Node
          title="Public manifest"
          tone="walrus"
          lines={[{ k: "walrus", v: "content_sha256 (readable)" }]}
        />
        <Arrow label="add_memwal_ref" />
        <Node
          title="Sui object"
          tone="chain"
          lines={[{ k: "on-chain", v: "Persona · memwal_refs[2]" }]}
        />
      </div>

      {/* Row 2 — report */}
      <div
        style={{ fontSize: 10, color: C.textFaint, margin: "14px 0 6px", fontWeight: 600 }}
      >
        ACROSS THE SCAN
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 4 }}>
        <Node
          title="N personas"
          tone="neutral"
          lines={[{ k: "scores", v: "5 dimensions each" }]}
        />
        <Arrow label="aggregate" />
        <Node
          title="Report"
          tone="neutral"
          lines={[{ k: "result", v: "audience-fit + funnel" }]}
        />
        <Arrow label="sha256 / Seal" />
        <Node
          title="Report integrity"
          tone="walrus"
          lines={[
            { k: "walrus", v: "sealed snapshot" },
            { k: "hash", v: "DB commit (no Sui obj yet)" },
          ]}
        />
      </div>

      <div style={{ fontSize: 10, color: C.textFaint, marginTop: 12, lineHeight: 1.5 }}>
        Honesty: sealed bytes are <b>gated</b> (Seal committee deferred) — we never
        claim the ciphertext is readable. The <b>public manifest</b> is what makes
        content verifiable: re-hash the plaintext in your browser and match it.
        Reports have <b>no Sui object yet</b> (scan≈Campaign escrow deferred), so
        their hash is a DB commitment. Personas are operator-owned synthetic seeds.
      </div>
    </Card>
  );
}

// ─── Persona drill-down ──────────────────────────────────────────────────────

function VerdictChip({ ok }: { ok: boolean | null }) {
  const map = ok
    ? { bg: C.okSoft, bd: "#c4e0d0", fg: C.ok, t: "✓ sha256 일치 · content verified" }
    : ok === false
      ? { bg: C.badSoft, bd: "#f0c4bc", fg: C.bad, t: "⚠ hash mismatch" }
      : { bg: C.accentSoft, bd: "#f5cdb6", fg: C.accent, t: "computing…" };
  return (
    <span
      style={{
        display: "inline-block",
        background: map.bg,
        border: `1px solid ${map.bd}`,
        color: map.fg,
        borderRadius: 5,
        padding: "3px 8px",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: FS,
      }}
    >
      {map.t}
    </span>
  );
}

function VLayer({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span
          style={{
            fontFamily: FM,
            fontSize: 11,
            color: C.accent,
            background: C.accentSoft,
            border: `1px solid #f5cdb6`,
            borderRadius: 4,
            width: 20,
            height: 20,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {n}
        </span>
        {n < 5 && <span style={{ flex: 1, width: 1, background: C.border, marginTop: 2 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.text,
            marginBottom: 5,
            fontFamily: FS,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function PersonaDrillDown({
  scanId,
  persona,
  scanFit,
}: {
  scanId: string;
  persona: ShowcasePersona;
  scanFit: number | null;
}) {
  const [proof, setProof] = useState<PersonaProof | null>(null);
  const [computed, setComputed] = useState<string | null>(null);
  const [match, setMatch] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProof(null);
    setComputed(null);
    setMatch(null);
    setErr(null);
    scanApi
      .getPersonaProof(scanId, persona.persona_id)
      .then(async (p) => {
        if (cancelled) return;
        setProof(p);
        const c = await browserSha256(p.content.plaintext);
        if (cancelled) return;
        setComputed(c);
        const mh =
          p.manifest && p.manifest.ok
            ? ((p.manifest.manifest as { content_sha256?: string }).content_sha256 ?? null)
            : null;
        setMatch(mh ? c === mh : null);
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : "failed"));
    return () => {
      cancelled = true;
    };
  }, [scanId, persona.persona_id]);

  const onchain = proof?.onchain && "exists" in proof.onchain ? proof.onchain : null;
  const manifestJson =
    proof?.manifest && proof.manifest.ok ? proof.manifest.manifest : null;
  let plaintextPretty = proof?.content.plaintext ?? "";
  try {
    if (proof) plaintextPretty = JSON.stringify(JSON.parse(proof.content.plaintext), null, 2);
  } catch {
    /* leave raw */
  }

  return (
    <Card padding={16} style={{ borderColor: "#f5cdb6" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
          {persona.cohort_label}{" "}
          <span style={{ ...mono, color: C.textFaint, fontSize: 11 }}>
            · {persona.persona_id.slice(0, 8)}
          </span>
        </div>
        <VerdictChip ok={match} />
      </div>
      {err && <div style={{ fontSize: 11, color: C.bad }}>proof failed — {err}</div>}
      {!proof && !err && (
        <div style={{ fontSize: 11, color: C.textFaint }}>Loading live proof…</div>
      )}

      {proof && (
        <>
          <VLayer n={1} title="Plaintext — the persona's memory vector">
            <pre
              style={{
                ...mono,
                fontSize: 10,
                whiteSpace: "pre-wrap",
                background: C.bg,
                padding: 8,
                borderRadius: 4,
                maxHeight: 150,
                overflow: "auto",
                margin: 0,
              }}
            >
              {plaintextPretty}
            </pre>
          </VLayer>

          <VLayer n={2} title="Sealed onto Walrus (Seal ciphertext · gated)">
            <div style={label}>blob is encrypted — not readable here, by design</div>
            {proof.anchor?.seal_blob_url ? (
              <Ext href={proof.anchor.seal_blob_url}>{proof.anchor.seal_blob_id} ↗</Ext>
            ) : (
              <div style={mono}>{proof.anchor?.seal_blob_id ?? "—"}</div>
            )}
          </VLayer>

          <VLayer n={3} title="Public content manifest on Walrus — what's actually recorded">
            {manifestJson ? (
              <pre
                style={{
                  ...mono,
                  fontSize: 10,
                  whiteSpace: "pre-wrap",
                  background: "#f4f9fc",
                  border: "1px solid #bcd5e8",
                  padding: 8,
                  borderRadius: 4,
                  margin: 0,
                }}
              >
                {JSON.stringify(manifestJson, null, 2)}
              </pre>
            ) : (
              <div style={{ fontSize: 11, color: C.textFaint }}>no manifest committed</div>
            )}
            <div style={{ marginTop: 6 }}>
              <div style={label}>your browser sha256(plaintext)</div>
              <div style={{ ...mono, fontSize: 11, color: match ? C.ok : C.text }}>
                {computed ?? "…"}
              </div>
            </div>
            {proof.anchor?.content_manifest_url && (
              <div style={{ marginTop: 4 }}>
                <Ext href={proof.anchor.content_manifest_url}>
                  fetch the manifest from Walrus yourself ↗
                </Ext>
              </div>
            )}
          </VLayer>

          <VLayer n={4} title="Sui object — links both blobs on-chain (live getObject)">
            {proof.anchor && (
              <Ext href={proof.anchor.object_url}>{proof.anchor.sui_object_id} ↗</Ext>
            )}
            {onchain && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 6 }}>
                <div>
                  <div style={label}>version</div>
                  <div style={mono}>{onchain.version ?? "—"}</div>
                </div>
                <div>
                  <div style={label}>memwal_refs (Walrus links)</div>
                  <div style={{ ...mono, fontSize: 10 }}>
                    {onchain.memwal_refs.length
                      ? onchain.memwal_refs.map((r) => r.slice(0, 10) + "…").join(" · ")
                      : "—"}
                  </div>
                </div>
              </div>
            )}
          </VLayer>

          <VLayer n={5} title="Feeds the report — this persona's 5 dimension scores">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(
                [
                  ["Happiness", persona.scores.happiness],
                  ["Engagement", persona.scores.engagement],
                  ["Task", persona.scores.task_success],
                  ["Adoption", persona.scores.adoption],
                  ["Retention D7", persona.scores.retention_d7],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 5,
                    padding: "4px 8px",
                    background: C.panel,
                  }}
                >
                  <div style={{ fontSize: 9, color: C.textFaint }}>{k}</div>
                  <div style={{ ...mono, fontSize: 13 }}>{v ?? "—"}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, lineHeight: 1.5 }}>
              These scores aggregate with the other anchored personas into the scan&apos;s
              audience-fit{" "}
              <span style={{ ...mono, color: C.text }}>
                {scanFit != null ? scanFit.toFixed(1) : "—"}
              </span>{" "}
              and AARRR funnel — the report whose integrity hash you can verify above.
            </div>
          </VLayer>
        </>
      )}
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ShowcaseInner() {
  const [data, setData] = useState<ChainShowcase | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<ShowcasePersona | null>(null);

  useEffect(() => {
    let cancelled = false;
    scanApi
      .getChainShowcase()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setSelected(d.personas[0] ?? null);
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : "failed"));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ padding: "24px 20px 60px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
          On-chain provenance
        </div>
        <div style={{ fontSize: 13, color: C.textDim, marginTop: 4, lineHeight: 1.5 }}>
          How 41R turns AI-persona evaluations into verifiable, tamper-evident
          records on Sui + Walrus + Seal — shown live, end to end.{" "}
          <Link href="/validator/how-it-works" style={{ color: C.accent, textDecoration: "none" }}>
            methodology ↗
          </Link>
        </div>
      </div>

      <FlowDiagram />

      {err && (
        <Card padding={16}>
          <div style={{ fontSize: 12, color: C.bad }}>Showcase unavailable — {err}</div>
        </Card>
      )}
      {!data && !err && (
        <Card padding={16}>
          <div style={{ fontSize: 12, color: C.textFaint }}>Loading live chain data…</div>
        </Card>
      )}

      {data && (
        <>
          {/* Live scan summary */}
          <Card padding={16}>
            <div
              style={{
                fontSize: 11,
                color: C.accent,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
                fontWeight: 700,
                fontFamily: FS,
              }}
            >
              Live · scan {data.scan.id.slice(0, 8)}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "baseline" }}>
              <div>
                <div style={label}>Target</div>
                <div style={{ fontSize: 13, color: C.text }}>{data.scan.target_url}</div>
              </div>
              <div>
                <div style={label}>Audience fit</div>
                <div style={{ ...mono, fontSize: 18 }}>
                  {data.scan.audience_fit_score != null
                    ? data.scan.audience_fit_score.toFixed(1)
                    : "—"}
                </div>
              </div>
              <div>
                <div style={label}>Best cohort</div>
                <div style={{ fontSize: 13, color: C.text }}>
                  {data.scan.best_cohort_label ?? "—"}
                </div>
              </div>
              <div>
                <div style={label}>Anchored personas</div>
                <div style={{ ...mono, fontSize: 18, color: C.accent }}>
                  {data.counts.anchored}
                  <span style={{ fontSize: 12, color: C.textFaint }}>
                    {" "}
                    / {data.counts.total_in_scan}
                  </span>
                </div>
              </div>
              <div>
                <div style={label}>Report hash</div>
                <div style={{ ...mono, fontSize: 11 }}>
                  {data.report_proof?.report?.content_hash
                    ? data.report_proof.report.content_hash.slice(0, 18) + "…"
                    : "not anchored"}
                </div>
              </div>
            </div>
          </Card>

          {/* Persona grid */}
          <Card padding={16}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>
              {data.counts.anchored} anchored persona objects on Sui testnet — click one
              to trace its full record.
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 8,
              }}
            >
              {data.personas.map((p) => {
                const active = selected?.persona_id === p.persona_id;
                return (
                  <button
                    key={p.persona_id}
                    onClick={() => setSelected(p)}
                    style={{
                      textAlign: "left",
                      cursor: "pointer",
                      border: `1px solid ${active ? C.accent : C.border}`,
                      background: active ? C.accentSoft : C.panel,
                      borderRadius: 7,
                      padding: "8px 10px",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>
                      {p.cohort_label}
                    </div>
                    <div style={{ ...mono, fontSize: 9, color: C.textFaint, marginTop: 2 }}>
                      {p.sui_object_id.slice(0, 12)}…
                    </div>
                    <div style={{ display: "flex", gap: 4, marginTop: 5, alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: 9,
                          color: p.content_hash ? C.ok : C.warn,
                          fontWeight: 600,
                        }}
                      >
                        {p.content_hash ? "● verified" : "● anchored"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Drill-down */}
          {selected && (
            <PersonaDrillDown
              scanId={data.scan.id}
              persona={selected}
              scanFit={data.scan.audience_fit_score}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function ProofShowcasePage() {
  return (
    <Frame>
      <Suspense fallback={null}>
        <ShowcaseInner />
      </Suspense>
    </Frame>
  );
}
