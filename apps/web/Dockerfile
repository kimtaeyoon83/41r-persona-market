FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/solana-utils/package.json ./packages/solana-utils/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/solana-utils/node_modules ./packages/solana-utils/node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_BSC_RPC_URL
ARG NEXT_PUBLIC_BSC_CHAIN_ID
ARG NEXT_PUBLIC_BSC_MOCKUSDC_ADDRESS
ARG NEXT_PUBLIC_X402_EVM_RESOURCE_WALLET
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_BSC_RPC_URL=${NEXT_PUBLIC_BSC_RPC_URL}
ENV NEXT_PUBLIC_BSC_CHAIN_ID=${NEXT_PUBLIC_BSC_CHAIN_ID}
ENV NEXT_PUBLIC_BSC_MOCKUSDC_ADDRESS=${NEXT_PUBLIC_BSC_MOCKUSDC_ADDRESS}
ENV NEXT_PUBLIC_X402_EVM_RESOURCE_WALLET=${NEXT_PUBLIC_X402_EVM_RESOURCE_WALLET}
RUN pnpm --filter @41rpm/shared build && \
    pnpm --filter @41rpm/solana-utils build && \
    pnpm --filter @41rpm/web build

# --- Production ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
