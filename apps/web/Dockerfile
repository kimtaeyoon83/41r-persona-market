FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL=https://api-production-a4e7.up.railway.app
# NEXT_PUBLIC_PRIVY_APP_ID is client-side public (visible in any
# browser DevTools), so committing the default is harmless. The
# server-only secret is PRIVY_APP_SECRET which stays on Railway env.
# Hardcoding the default sidesteps Railway's inconsistent build-arg
# pass-through behavior — service env vars sometimes don't reach
# `docker build` even when declared as ARG.
ARG NEXT_PUBLIC_PRIVY_APP_ID=cmor17hr1005w0dl1nnqmhhsy
# NEXT_PUBLIC_* are inlined at `next build` time — Railway service vars don't
# reliably reach the Docker build (same gotcha as PRIVY_APP_ID above), so the
# USDC rail + Sui network must be baked in as ARG defaults or the prod bundle
# ships them undefined (USDC_PAY_ENABLED=false → wallet/pay UI hidden). USDC
# user-side transfer is verified+enabled (2026-06-22), so default it ON.
ARG NEXT_PUBLIC_USDC_ENABLED=1
ARG NEXT_PUBLIC_SUI_NETWORK=testnet
# Dogfooding — the 41R app tracks itself. This is the PUBLIC site key
# (rpm_pk_, GA-measurement-id semantics, safe to commit); the rpm_sk_ secret
# is server-only and never appears here or in the client. layout.tsx injects
# the t.js beacon when this + NEXT_PUBLIC_API_URL are set.
ARG NEXT_PUBLIC_TRACKING_SITE_KEY=rpm_pk_ffe4df49792b0d6f897343fe
# Dogfooding — anchor scan of app.project-rpm.xyz whose human survey is
# surfaced as a CTA on My Page. Public id, safe to commit.
ARG NEXT_PUBLIC_DOGFOOD_SURVEY_SCAN_ID=4cb0677b-baab-47f6-81d5-9e276b08050b
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_PRIVY_APP_ID=${NEXT_PUBLIC_PRIVY_APP_ID}
ENV NEXT_PUBLIC_USDC_ENABLED=${NEXT_PUBLIC_USDC_ENABLED}
ENV NEXT_PUBLIC_SUI_NETWORK=${NEXT_PUBLIC_SUI_NETWORK}
ENV NEXT_PUBLIC_TRACKING_SITE_KEY=${NEXT_PUBLIC_TRACKING_SITE_KEY}
ENV NEXT_PUBLIC_DOGFOOD_SURVEY_SCAN_ID=${NEXT_PUBLIC_DOGFOOD_SURVEY_SCAN_ID}
RUN pnpm --filter @41rpm/shared build && \
    pnpm --filter @41rpm/web build

# --- Production ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
