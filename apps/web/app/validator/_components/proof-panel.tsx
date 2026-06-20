"use client";

// Proof panel — the on-chain "verify it yourself" surface for a persona (and a
// lighter variant for a scan report). Replaces the old read-only link strip with
// three layers of escalating trust:
//   1. live on-chain object (owner / version / memwal refs) — measured, not DB
//   2. sealed blob (Seal ciphertext — gated, we never claim it's readable here)
//   3. plaintext + browser-computed sha256 → matched against the PUBLIC Walrus
//      manifest hash → "내용 검증됨 · sha256 일치"
//
// The verdict escalates: anchored+sealed (existence) → content-verified
// (integrity). When the hashes don't match, we say so loudly rather than hide it.

import { useEffect, useState } from "react";
import { scanApi, type PersonaProof, type ReportProof } from "@/lib/api";
import { C, Card, FM, FS } from "./ui";

/** Browser-side sha256 over the exact plaintext the server hashed. WebCrypto is
 *  available in every target browser; this is what makes the check independent
 *  of our backend. */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function manifestHashOf(p: PersonaProof): string | null {
  if (!p.manifest || !p.manifest.ok) return null;
  const m = p.manifest.manifest as { content_sha256?: unknown };
  return typeof m?.content_sha256 === "string" ? m.content_sha256 : null;
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: C.textFaint,
  marginBottom: 3,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const monoStyle: React.CSSProperties = {
  fontFamily: FM,
  fontSize: 12,
  color: C.text,
  wordBreak: "break-all",
};

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...monoStyle, color: C.accent, textDecoration: "none" }}
    >
      {children}
    </a>
  );
}

function SectionHead({ n, title }: { n: number; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span
        style={{
          fontFamily: FM,
          fontSize: 11,
          color: C.accent,
          border: `1px solid ${C.accentSoft}`,
          background: C.accentSoft,
          borderRadius: 4,
          width: 18,
          height: 18,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <span
        style={{
          fontSize: 11,
          color: C.text,
          fontWeight: 600,
          fontFamily: FS,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {title}
      </span>
    </div>
  );
}

type Verdict = "pending" | "match" | "mismatch" | "no-manifest" | "unanchored";

function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const map: Record<Verdict, { bg: string; bd: string; fg: string; text: string }> = {
    match: {
      bg: C.okSoft,
      bd: "#c4e0d0",
      fg: C.ok,
      text: "✓ 내용 검증됨 · sha256 일치 (Content verified — browser hash matches the on-chain commitment)",
    },
    mismatch: {
      bg: C.badSoft,
      bd: "#f0c4bc",
      fg: C.bad,
      text: "⚠ 해시 불일치 — 내용이 변조되었거나 매니페스트와 다릅니다 (hash mismatch — content differs from the committed manifest)",
    },
    "no-manifest": {
      bg: C.warnSoft,
      bd: "#ecdcab",
      fg: C.warn,
      text: "앵커됨 · 봉인됨 — 콘텐츠 매니페스트 미커밋 (anchored & sealed; no public content-hash manifest yet)",
    },
    pending: {
      bg: C.accentSoft,
      bd: "#f5cdb6",
      fg: C.accent,
      text: "브라우저에서 sha256 계산 중… (computing hash in your browser…)",
    },
    unanchored: {
      bg: C.warnSoft,
      bd: "#ecdcab",
      fg: C.warn,
      text: "아직 온체인 앵커되지 않음 (not yet anchored on-chain)",
    },
  };
  const v = map[verdict];
  return (
    <div
      style={{
        background: v.bg,
        border: `1px solid ${v.bd}`,
        borderRadius: 6,
        padding: "8px 10px",
        color: v.fg,
        fontSize: 11,
        lineHeight: 1.5,
        fontWeight: 600,
        fontFamily: FS,
      }}
    >
      {v.text}
    </div>
  );
}

export function PersonaProofPanel({
  scanId,
  personaId,
}: {
  scanId: string;
  personaId: string;
}) {
  const [proof, setProof] = useState<PersonaProof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict>("pending");

  useEffect(() => {
    let cancelled = false;
    scanApi
      .getPersonaProof(scanId, personaId)
      .then(async (p) => {
        if (cancelled) return;
        setProof(p);
        if (!p.anchored) {
          setVerdict("unanchored");
          return;
        }
        const computed = await sha256Hex(p.content.plaintext);
        if (cancelled) return;
        setComputedHash(computed);
        const mh = manifestHashOf(p);
        if (!mh) setVerdict("no-manifest");
        else setVerdict(computed === mh ? "match" : "mismatch");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "proof failed");
      });
    return () => {
      cancelled = true;
    };
  }, [scanId, personaId]);

  if (error) {
    return (
      <Card padding={14}>
        <div style={{ fontSize: 11, color: C.textDim }}>
          On-chain proof unavailable — {error}
        </div>
      </Card>
    );
  }
  if (!proof) {
    return (
      <Card padding={14}>
        <div style={{ fontSize: 11, color: C.textFaint }}>Loading on-chain proof…</div>
      </Card>
    );
  }

  const onchain = proof.onchain && "exists" in proof.onchain ? proof.onchain : null;
  const onchainErr =
    proof.onchain && "error" in proof.onchain ? proof.onchain.error : null;
  const mh = manifestHashOf(proof);

  return (
    <Card padding={14}>
      <div
        style={{
          fontSize: 11,
          color: C.accent,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 10,
          fontWeight: 600,
          fontFamily: FS,
        }}
      >
        On-chain proof · Sui testnet
      </div>

      <div style={{ marginBottom: 12 }}>
        <VerdictBanner verdict={verdict} />
      </div>

      {/* Layer 1 — live on-chain object */}
      <div style={{ marginBottom: 14 }}>
        <SectionHead n={1} title="On-chain object (live)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            <div style={labelStyle}>Persona object</div>
            <ExtLink href={proof.anchor!.object_url}>
              {proof.anchor!.sui_object_id} ↗
            </ExtLink>
          </div>
          {onchain && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={labelStyle}>Version</div>
                <div style={monoStyle}>{onchain.version ?? "—"}</div>
              </div>
              <div>
                <div style={labelStyle}>MemWal refs</div>
                <div style={monoStyle}>{onchain.memwal_count}</div>
              </div>
              <div>
                <div style={labelStyle}>Owner</div>
                <div style={{ ...monoStyle, fontSize: 11 }}>
                  {typeof onchain.owner === "object" && onchain.owner
                    ? ((Object.values(onchain.owner)[0] as string) ?? "").slice(0, 14) + "…"
                    : "—"}
                </div>
              </div>
            </div>
          )}
          {onchainErr && (
            <div style={{ fontSize: 11, color: C.warn }}>
              live read failed ({onchainErr}) — committed refs only
            </div>
          )}
        </div>
      </div>

      {/* Layer 2 — sealed blob */}
      {proof.anchor!.seal_blob_id && (
        <div style={{ marginBottom: 14 }}>
          <SectionHead n={2} title="Sealed memory blob (gated)" />
          <div style={labelStyle}>Walrus blob · Seal-encrypted · not readable here</div>
          {proof.anchor!.seal_blob_url ? (
            <ExtLink href={proof.anchor!.seal_blob_url}>
              {proof.anchor!.seal_blob_id} ↗
            </ExtLink>
          ) : (
            <div style={monoStyle}>{proof.anchor!.seal_blob_id}</div>
          )}
        </div>
      )}

      {/* Layer 3 — content verification */}
      <div>
        <SectionHead n={3} title="Content integrity (verify in browser)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            <div style={labelStyle}>Your browser computed sha256(plaintext)</div>
            <div
              style={{
                ...monoStyle,
                fontSize: 11,
                color: verdict === "match" ? C.ok : C.text,
              }}
            >
              {computedHash ?? "…"}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Public manifest hash (Walrus)</div>
            <div style={{ ...monoStyle, fontSize: 11 }}>{mh ?? "— (not committed)"}</div>
          </div>
          {proof.anchor!.content_manifest_url && (
            <div>
              <ExtLink href={proof.anchor!.content_manifest_url}>
                Inspect the public manifest yourself ↗
              </ExtLink>
            </div>
          )}
          <details style={{ marginTop: 4 }}>
            <summary
              style={{ fontSize: 11, color: C.textDim, cursor: "pointer", fontFamily: FS }}
            >
              Show plaintext the hash is taken over
            </summary>
            <pre
              style={{
                ...monoStyle,
                fontSize: 10,
                whiteSpace: "pre-wrap",
                background: C.bg,
                padding: 8,
                borderRadius: 4,
                marginTop: 6,
                maxHeight: 160,
                overflow: "auto",
              }}
            >
              {proof.content.plaintext}
            </pre>
          </details>
        </div>
      </div>
    </Card>
  );
}

export function ReportProofPanel({ scanId }: { scanId: string }) {
  const [proof, setProof] = useState<ReportProof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const [match, setMatch] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    scanApi
      .getReportProof(scanId)
      .then(async (p) => {
        if (cancelled) return;
        setProof(p);
        if (p.report?.content_hash) {
          const computed = await sha256Hex(p.report.plaintext);
          if (cancelled) return;
          setComputedHash(computed);
          setMatch(computed === p.report.content_hash);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "proof failed");
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  // Hidden entirely when there's nothing anchored — no fake/empty state.
  if (error || !proof || !proof.anchored || !proof.report) return null;

  return (
    <Card padding={14}>
      <div
        style={{
          fontSize: 11,
          color: C.accent,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 10,
          fontWeight: 600,
          fontFamily: FS,
        }}
      >
        Report integrity · Walrus
      </div>
      <div
        style={{
          background: match ? C.okSoft : C.warnSoft,
          border: `1px solid ${match ? "#c4e0d0" : "#ecdcab"}`,
          borderRadius: 6,
          padding: "8px 10px",
          color: match ? C.ok : C.warn,
          fontSize: 11,
          lineHeight: 1.5,
          fontWeight: 600,
          marginBottom: 12,
          fontFamily: FS,
        }}
      >
        {match
          ? "✓ 리포트 무결성 검증됨 · sha256 일치 (report hash matches the committed snapshot)"
          : "리포트 스냅샷 해시 (recompute to verify)"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div>
          <div style={labelStyle}>Browser sha256(report)</div>
          <div style={{ ...monoStyle, fontSize: 11 }}>{computedHash ?? "…"}</div>
        </div>
        <div>
          <div style={labelStyle}>Committed hash</div>
          <div style={{ ...monoStyle, fontSize: 11 }}>{proof.report.content_hash}</div>
        </div>
        {proof.report.seal_blob_url && (
          <div>
            <div style={labelStyle}>Sealed report blob (Walrus · gated)</div>
            <ExtLink href={proof.report.seal_blob_url}>
              {proof.report.seal_blob_id} ↗
            </ExtLink>
          </div>
        )}
        <div style={{ fontSize: 10, color: C.textFaint, lineHeight: 1.5, marginTop: 2 }}>
          {proof.report.note}
        </div>
      </div>
    </Card>
  );
}
