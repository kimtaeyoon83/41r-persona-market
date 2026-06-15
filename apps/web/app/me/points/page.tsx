"use client";

// /me/points — full point + credit ledgers (Console Sprint 1).
//
// The points API (/api/me/points) existed since the geulbat pilot with
// no UI consumer — this page closes that gap. Credits get a second
// table on the same page (both are short ledgers at this stage; split
// when either grows). Zero-amount rows are rendered too — when the
// reward cap marks a survey "no reward", the transparent 0pt row with
// its reason is the trust mechanism (console-ia-redesign.md §6).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { meApi, type MyPoints, type MyCredits } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { C, FM, FS, Frame } from "../../validator/_components/ui";

export default function PointsPage() {
  const { ready, authenticated, login } = useAuth();
  const { t } = useI18n();
  const [points, setPoints] = useState<MyPoints | null>(null);
  const [credits, setCredits] = useState<MyCredits | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    Promise.all([meApi.getPoints(), meApi.getCredits()])
      .then(([p, c]) => {
        if (cancelled) return;
        setPoints(p);
        setCredits(c);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated]);

  if (!ready) {
    return (
      <Frame>
        <Center>{t("common.loading")}</Center>
      </Frame>
    );
  }
  if (!authenticated) {
    return (
      <Frame>
        <Center>
          <h1 style={{ fontSize: 24, fontWeight: 600, fontFamily: FS, marginBottom: 14 }}>
            {t("common.signInTitle")}
          </h1>
          <button
            onClick={login}
            style={{
              padding: "10px 22px",
              fontSize: 13,
              fontWeight: 600,
              background: C.text,
              color: C.bg,
              border: "none",
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: FS,
            }}
          >
            {t("nav.signIn")}
          </button>
        </Center>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="v-page-pad" style={{ maxWidth: 880, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <Link
            href="/me"
            style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, textDecoration: "none" }}
          >
            ← {t("me.title")}
          </Link>
        </div>

        {error && (
          <div style={{ color: C.bad, fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        {/* Points */}
        <h1 style={{ fontSize: 24, fontWeight: 600, fontFamily: FS, marginBottom: 4 }}>
          {t("me.pointsHistory")}
        </h1>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 28, fontWeight: 600, fontFamily: FM }}>
            {points ? `${points.balance.toLocaleString()} pt` : "…"}
          </span>
          <span style={{ fontSize: 11, color: C.textFaint }}>{t("me.policyPending")}</span>
        </div>
        <LedgerCard>
          {points == null ? (
            <Empty>{t("common.loading")}</Empty>
          ) : points.transactions.length === 0 ? (
            <Empty>{t("me.noPoints")}</Empty>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={headRow}>
                  <th style={th}>{t("me.date")}</th>
                  <th style={th}>{t("me.reason")}</th>
                  <th style={th}>{t("me.source")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("me.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {points.transactions.map((tx, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ ...td, fontFamily: FM, fontSize: 11 }}>
                      {fmtDateTime(tx.created_at)}
                    </td>
                    <td style={td}>{tx.reason}</td>
                    <td style={td}>{tx.source}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: FM,
                        fontWeight: 600,
                        color: tx.amount > 0 ? C.ok : tx.amount < 0 ? C.bad : C.textFaint,
                      }}
                    >
                      {tx.amount > 0 ? "+" : ""}
                      {tx.amount} pt
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </LedgerCard>

        {/* Credits */}
        <h2 style={{ fontSize: 18, fontWeight: 600, fontFamily: FS, margin: "30px 0 4px" }}>
          {t("me.creditHistory")}
        </h2>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 22, fontWeight: 600, fontFamily: FM }}>
            {credits ? `$${(credits.balance_cents / 100).toFixed(2)}` : "…"}
          </span>
          <span style={{ fontSize: 11, color: C.textFaint }}>{t("me.creditNote")}</span>
        </div>
        <LedgerCard>
          {credits == null ? (
            <Empty>{t("common.loading")}</Empty>
          ) : credits.transactions.length === 0 ? (
            <Empty>{t("me.noCredits")}</Empty>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={headRow}>
                  <th style={th}>{t("me.date")}</th>
                  <th style={th}>{t("me.reason")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("me.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {credits.transactions.map((tx, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ ...td, fontFamily: FM, fontSize: 11 }}>
                      {fmtDateTime(tx.created_at)}
                    </td>
                    <td style={td}>{tx.reason}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: FM,
                        fontWeight: 600,
                        color: tx.amount_cents > 0 ? C.ok : C.textDim,
                      }}
                    >
                      {tx.amount_cents > 0 ? "+" : "−"}$
                      {Math.abs(tx.amount_cents / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </LedgerCard>
      </div>
    </Frame>
  );
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};
const headRow: React.CSSProperties = {
  textAlign: "left",
  color: "#9a9489",
  fontFamily: FM,
  fontSize: 10,
};
const th: React.CSSProperties = {
  padding: "6px 8px",
  fontWeight: 500,
  letterSpacing: "0.06em",
};
const td: React.CSSProperties = { padding: "9px 8px" };

function LedgerCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 12,
        overflowX: "auto",
      }}
    >
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 22, textAlign: "center", color: C.textDim, fontSize: 12 }}>
      {children}
    </div>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ padding: "120px 32px", textAlign: "center", color: C.textDim, fontSize: 14 }}
    >
      {children}
    </div>
  );
}
