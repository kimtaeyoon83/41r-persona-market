"use client";

// /me — Tester Home dashboard (Console Sprint 1, console-ia-redesign.md §7.4).
//
// Point balance (earn side) + credit balance (spend side) + recent
// activity, with links into the full ledgers / survey history / wallet.
// Policy copy is deliberately non-committal: the point→USDC conversion
// is undecided and the UI must not promise it (§4.3 — the ledger is
// append-only so any future policy reprices retroactively).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { meApi, type MyPoints, type MyCredits } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { C, FM, FS, Frame } from "../validator/_components/ui";

// Dogfooding — the anchor scan whose human survey is open to testers from
// My Page. Set via NEXT_PUBLIC_DOGFOOD_SURVEY_SCAN_ID (baked in the web
// Dockerfile, GA-id-like). When unset the survey CTA simply doesn't render.
const SURVEY_SCAN_ID = process.env.NEXT_PUBLIC_DOGFOOD_SURVEY_SCAN_ID;

export default function MyPage() {
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
          <h1 style={{ fontSize: 26, fontWeight: 600, fontFamily: FS, marginBottom: 8 }}>
            {t("common.signInTitle")}
          </h1>
          <div style={{ fontSize: 13, color: C.textDim, marginBottom: 18 }}>
            {t("common.signInBody")}
          </div>
          <button
            onClick={login}
            style={{
              padding: "12px 24px",
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
      <div className="v-page-pad" style={{ maxWidth: 1080, margin: "0 auto" }}>
        <h1 style={{ fontSize: 30, fontWeight: 600, fontFamily: FS, marginBottom: 6 }}>
          {t("me.title")}
        </h1>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 28 }}>
          {t("me.taglineTester")}
        </div>

        {error && (
          <div style={{ color: C.bad, fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        {/* Balances */}
        <div
          className="v-grid-stack-sm"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <BalanceCard
            label={t("me.points")}
            value={points ? `${points.balance.toLocaleString()} pt` : "…"}
            sub={t("me.policyPending")}
            href="/me/points"
            linkLabel={t("me.pointsHistory")}
          />
          <BalanceCard
            label={t("me.credits")}
            value={credits ? `$${(credits.balance_cents / 100).toFixed(2)}` : "…"}
            sub={t("me.creditNote")}
            href="/console"
            linkLabel={t("nav.console")}
          />
        </div>

        {/* Recent activity */}
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            {t("me.recentActivity")}
          </div>
          <RecentActivity points={points} credits={credits} />
        </div>

        {/* Open survey CTA (dogfooding) — earns points, feeds the AI↔human
            comparison for the anchored scan. */}
        {SURVEY_SCAN_ID && (
          <Link
            href={`/validator/survey/${SURVEY_SCAN_ID}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: C.accentSoft,
              border: `1px solid #d4d0fb`,
              borderRadius: 14,
              padding: 16,
              textDecoration: "none",
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>📋</span>
            <span style={{ flex: 1 }}>
              <span
                style={{ display: "block", fontSize: 14, fontWeight: 600, color: C.text }}
              >
                {t("me.surveyCta")}
              </span>
              <span style={{ fontSize: 12, color: C.textDim }}>{t("me.surveyCtaSub")}</span>
            </span>
            <span
              style={{
                fontFamily: FM,
                fontSize: 12,
                fontWeight: 600,
                color: C.accent,
                whiteSpace: "nowrap",
              }}
            >
              +100 pt →
            </span>
          </Link>
        )}

        {/* Quick links */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <QuickLink href="/me/responses" label={t("me.myResponses")} />
          <QuickLink href="/me/points" label={t("me.pointsHistory")} />
          <QuickLink href="/me/wallet" label={t("me.wallet")} />
        </div>
      </div>
    </Frame>
  );
}

function BalanceCard({
  label,
  value,
  sub,
  href,
  linkLabel,
}: {
  label: string;
  value: string;
  sub: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 18,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: C.textFaint,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontFamily: FM,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 600, fontFamily: FM, marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 10 }}>{sub}</div>
      <Link href={href} style={{ fontSize: 12, color: C.accent, textDecoration: "none" }}>
        {linkLabel} →
      </Link>
    </div>
  );
}

function RecentActivity({
  points,
  credits,
}: {
  points: MyPoints | null;
  credits: MyCredits | null;
}) {
  const { t } = useI18n();
  type Row = { at: string; text: string; amount: string; tone: string };
  const rows: Row[] = [];
  for (const tx of points?.transactions.slice(0, 3) ?? []) {
    rows.push({
      at: tx.created_at,
      text: `${tx.reason} · ${tx.source}`,
      amount: `${tx.amount > 0 ? "+" : ""}${tx.amount} pt`,
      tone: tx.amount >= 0 ? C.ok : C.bad,
    });
  }
  for (const tx of credits?.transactions.slice(0, 3) ?? []) {
    rows.push({
      at: tx.created_at,
      text: tx.reason,
      amount: `${tx.amount_cents > 0 ? "+" : "−"}$${Math.abs(tx.amount_cents / 100).toFixed(2)}`,
      tone: tx.amount_cents >= 0 ? C.ok : C.textDim,
    });
  }
  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (rows.length === 0) {
    return <div style={{ fontSize: 12, color: C.textDim }}>{t("me.noPoints")}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.slice(0, 5).map((r, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            padding: "8px 0",
            borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
            fontSize: 12,
          }}
        >
          <span style={{ fontFamily: FM, color: C.textFaint, fontSize: 11, width: 84 }}>
            {fmtDate(r.at)}
          </span>
          <span style={{ flex: 1, color: C.text }}>{r.text}</span>
          <span style={{ fontFamily: FM, fontWeight: 600, color: r.tone }}>{r.amount}</span>
        </div>
      ))}
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="e-card"
      style={{
        border: `1px solid ${C.border}`,
        background: C.panel,
        borderRadius: 10,
        padding: "10px 18px",
        fontSize: 13,
        textDecoration: "none",
        color: C.text,
      }}
    >
      {label} →
    </Link>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(
    2,
    "0",
  )} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
