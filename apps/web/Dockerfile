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
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_PRIVY_APP_ID=${NEXT_PUBLIC_PRIVY_APP_ID}
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
