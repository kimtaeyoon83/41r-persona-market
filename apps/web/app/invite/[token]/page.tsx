"use client";

// /invite/[token] — team invite link landing.
//
// The owner copies this link (console → site → Settings → Team → Copy invite
// link) and shares it via messenger. The recipient opens it, signs in with ANY
// account (no email match needed), and is added as a read-only viewer, then
// redirected to the shared site. The token is the credential.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { consoleApi } from "@/lib/api";
import { Btn, C, FM, FS, Frame } from "../../validator/_components/ui";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ? String(params.token) : "";
  const router = useRouter();
  const { ready, authenticated, login } = useAuth();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated || !token || tried) return;
    setTried(true);
    consoleApi
      .acceptInvite(token)
      .then((r) => router.replace(`/console/sites/${r.workspace_id}`))
      .catch((e) => setError(e instanceof Error ? e.message : "invalid_invite"));
  }, [ready, authenticated, token, tried, router]);

  return (
    <Frame>
      <div
        className="v-page-pad"
        style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", paddingTop: 72 }}
      >
        <div
          style={{
            fontFamily: FM,
            fontSize: 11,
            color: C.textFaint,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          41R · Team
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 600, fontFamily: FS, margin: "0 0 14px" }}>
          {t("invite.title")}
        </h1>

        {!ready ? (
          <div style={{ fontSize: 13, color: C.textDim }}>{t("common.loading")}</div>
        ) : !authenticated ? (
          <>
            <p style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, margin: "0 0 20px" }}>
              {t("invite.signInToJoin")}
            </p>
            <Btn primary onClick={login}>
              {t("invite.signIn")}
            </Btn>
          </>
        ) : error ? (
          <p style={{ fontSize: 14, color: C.bad, lineHeight: 1.6 }}>{t("invite.invalid")}</p>
        ) : (
          <div style={{ fontSize: 14, color: C.textDim }}>{t("invite.joining")}</div>
        )}
      </div>
    </Frame>
  );
}
