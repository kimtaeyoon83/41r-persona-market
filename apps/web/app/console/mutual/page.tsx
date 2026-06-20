"use client";

// /console/mutual — Mutual-sealed campaigns (design doc §4.5).
//
// The product face of rpm::mutual. A company seals a pre-release asset; a
// persona owner opts in (by id), seals session evidence; an escrow-backed
// state machine drives the two-way reveal. Off-chain seal is the live
// artifact — the on-chain Sui mint is deferred (mutual.offchainNote), so
// the copy says so rather than implying a finished chain flow.
//
// Console screen → uses t() from day one (console-ia-redesign.md §12-5).

import { Suspense, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { mutualApi, type MutualCampaign, type MutualState } from "@/lib/api";
import { C, FM, Pill, Card, Btn } from "../../validator/_components/ui";
import { ConsoleShell } from "../_components/shell";

export default function MutualPage() {
  return (
    <Suspense fallback={null}>
      <ConsoleShell>
        <MutualInner />
      </ConsoleShell>
    </Suspense>
  );
}

/** Browser-side UTF-8 → base64 (assets here are small text/links). */
function toB64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

/** State → pill tone. */
function stateTone(s: MutualState) {
  if (s === "settled") return "ok" as const;
  if (s === "aborted") return "bad" as const;
  if (s === "asset_sealed") return "neutral" as const;
  return "accent" as const;
}

type LifecycleAction = "reveal-asset" | "commit-evidence" | "reveal-evidence" | "settle" | "slash";

/** Lifecycle actions available to the viewer, given state + role. Mirrors
 *  the backend ACTION_ACTOR + transition table exactly. */
function availableActions(c: MutualCampaign): LifecycleAction[] {
  const out: LifecycleAction[] = [];
  if (c.is_requester) {
    if (c.state === "evidence_committed") out.push("reveal-evidence");
    if (c.state === "evidence_revealed") out.push("settle");
    if (["persona_opted_in", "asset_revealed", "evidence_committed"].includes(c.state))
      out.push("slash");
  } else {
    if (c.state === "persona_opted_in") out.push("reveal-asset");
    if (c.state === "asset_revealed") out.push("commit-evidence");
  }
  return out;
}

const ACTION_KEY: Record<LifecycleAction, MessageKey> = {
  "reveal-asset": "mutual.action.reveal_asset",
  "commit-evidence": "mutual.action.commit_evidence",
  "reveal-evidence": "mutual.action.reveal_evidence",
  settle: "mutual.action.settle",
  slash: "mutual.action.slash",
};

function MutualInner() {
  const { ready, authenticated, login } = useAuth();
  const { t } = useI18n();
  const [items, setItems] = useState<MutualCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    mutualApi
      .list()
      .then((r) => setItems(r.campaigns))
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    if (ready && authenticated) load();
  }, [ready, authenticated, load]);

  const upsert = useCallback((c: MutualCampaign) => {
    setItems((prev) => {
      const rest = (prev ?? []).filter((x) => x.id !== c.id);
      return [c, ...rest];
    });
  }, []);

  if (ready && !authenticated) {
    return (
      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("common.signInTitle")}</div>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 14 }}>
          {t("common.signInBody")}
        </div>
        <Btn primary onClick={login}>
          {t("nav.signIn")}
        </Btn>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>{t("mutual.title")}</h1>
        <p style={{ fontSize: 13, color: C.textDim, margin: 0, maxWidth: 680 }}>
          {t("mutual.subtitle")}
        </p>
        <p
          style={{
            fontSize: 11.5,
            color: C.textFaint,
            margin: "8px 0 0",
            maxWidth: 680,
            fontFamily: FM,
          }}
        >
          {t("mutual.offchainNote")}
        </p>
      </header>

      <CreateForm onCreated={upsert} />
      <JoinByIdForm onJoined={upsert} />

      {error && <div style={{ color: C.bad, fontSize: 13 }}>{error}</div>}

      {items === null ? (
        <div style={{ fontSize: 13, color: C.textFaint }}>{t("common.loading")}</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 13, color: C.textFaint }}>{t("mutual.empty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((c) => (
            <CampaignCard key={c.id} c={c} onChange={upsert} onError={setError} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: (c: MutualCampaign) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [asset, setAsset] = useState("");
  const [sandbox, setSandbox] = useState(true);
  const [reward, setReward] = useState("");
  const [stake, setStake] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !asset.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await mutualApi.create({
        title: title.trim(),
        description: desc.trim() || undefined,
        asset_base64: toB64(asset),
        sandbox_only: sandbox,
        reward_amount: reward ? Number(reward) : undefined,
        stake_amount: stake ? Number(stake) : undefined,
      });
      onCreated(r.campaign);
      setTitle("");
      setDesc("");
      setAsset("");
      setReward("");
      setStake("");
      setOpen(false);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <Btn primary onClick={() => setOpen(true)}>
          + {t("mutual.new")}
        </Btn>
      </div>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label={t("mutual.titleField")}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
        </Field>
        <Field label={t("mutual.descField")}>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} style={inputStyle} />
        </Field>
        <Field label={t("mutual.asset")} hint={t("mutual.assetHint")}>
          <textarea
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", fontFamily: FM }}
          />
        </Field>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label={t("mutual.reward")}>
            <input
              value={reward}
              inputMode="numeric"
              onChange={(e) => setReward(e.target.value.replace(/[^0-9]/g, ""))}
              style={inputStyle}
            />
          </Field>
          <Field label={t("mutual.stake")}>
            <input
              value={stake}
              inputMode="numeric"
              onChange={(e) => setStake(e.target.value.replace(/[^0-9]/g, ""))}
              style={inputStyle}
            />
          </Field>
        </div>
        <label style={{ fontSize: 12.5, display: "flex", gap: 7, alignItems: "center" }}>
          <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
          {t("mutual.sandboxOnly")}
        </label>
        {err && <div style={{ color: C.bad, fontSize: 12.5 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <Btn primary onClick={submit}>
            {busy ? t("mutual.creating") : t("mutual.submit")}
          </Btn>
          <Btn onClick={() => setOpen(false)}>{t("common.back")}</Btn>
        </div>
      </div>
    </Card>
  );
}

function JoinByIdForm({ onJoined }: { onJoined: (c: MutualCampaign) => void }) {
  const { t } = useI18n();
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const join = async () => {
    if (!id.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await mutualApi.optIn(id.trim());
      onJoined(r.campaign);
      setId("");
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding={14}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.textDim }}>{t("mutual.action.opt_in")}:</span>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="campaign id"
          style={{ ...inputStyle, maxWidth: 320, fontFamily: FM, fontSize: 12 }}
        />
        <Btn onClick={join}>{busy ? "…" : t("mutual.action.opt_in")}</Btn>
        {err && <span style={{ color: C.bad, fontSize: 12 }}>{err}</span>}
      </div>
    </Card>
  );
}

function CampaignCard({
  c,
  onChange,
  onError,
}: {
  c: MutualCampaign;
  onChange: (c: MutualCampaign) => void;
  onError: (e: string) => void;
}) {
  const { t } = useI18n();
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const actions = availableActions(c);

  const run = async (action: LifecycleAction) => {
    setBusy(action);
    try {
      const r =
        action === "commit-evidence"
          ? await mutualApi.commitEvidence(c.id, toB64(evidence || c.id))
          : await mutualApi.transition(c.id, action);
      onChange(r.campaign);
      setEvidence("");
    } catch (e) {
      onError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card padding={16}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{c.title}</div>
          {c.description && (
            <div style={{ fontSize: 12.5, color: C.textDim, marginTop: 2 }}>{c.description}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Pill tone={stateTone(c.state)}>{t(`mutual.state.${c.state}` as MessageKey)}</Pill>
          <Pill tone={c.is_requester ? "accent" : "neutral"}>
            {c.is_requester ? "requester" : "persona"}
          </Pill>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 10,
          fontSize: 11.5,
          fontFamily: FM,
          color: C.textDim,
          flexWrap: "wrap",
        }}
      >
        <span>
          {t("mutual.rewardLabel")} {c.reward_amount}
        </span>
        <span>
          {t("mutual.stakeLabel")} {c.stake_amount}
        </span>
        <span style={{ color: C.textFaint }}>id {c.id.slice(0, 8)}</span>
      </div>

      {/* Sealed-blob links — shown ONLY when sealed (hidden-when-unsealed). */}
      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11.5, flexWrap: "wrap" }}>
        {c.asset_sealed && c.asset_walrus_url ? (
          <a href={c.asset_walrus_url} target="_blank" rel="noreferrer" style={linkStyle}>
            {t("mutual.assetSealed")} ↗
          </a>
        ) : (
          <span style={{ color: C.textFaint }}>{t("mutual.notSealed")}</span>
        )}
        {c.evidence_sealed && c.evidence_walrus_url && (
          <a href={c.evidence_walrus_url} target="_blank" rel="noreferrer" style={linkStyle}>
            {t("mutual.evidenceSealed")} ↗
          </a>
        )}
      </div>

      {/* Evidence input appears only when the persona may commit. */}
      {!c.is_requester && c.state === "asset_revealed" && (
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          rows={2}
          placeholder={t("mutual.evidencePrompt")}
          style={{ ...inputStyle, marginTop: 10, resize: "vertical", fontFamily: FM }}
        />
      )}

      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {actions.map((a) => (
            <Btn
              key={a}
              primary={a !== "slash"}
              onClick={() => run(a)}
              style={a === "slash" ? { color: C.bad, borderColor: C.bad } : undefined}
            >
              {busy === a ? "…" : t(ACTION_KEY[a])}
            </Btn>
          ))}
        </div>
      )}
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", flex: 1 }}>
      <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 7,
  border: `1px solid ${C.border}`,
  fontSize: 13,
  background: C.bg,
  color: C.text,
  boxSizing: "border-box",
};

const linkStyle: React.CSSProperties = {
  color: C.accent,
  textDecoration: "none",
  fontFamily: FM,
};
