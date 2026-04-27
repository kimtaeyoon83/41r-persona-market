FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/solana-utils/package.json ./packages/solana-utils/
COPY packages/persona-client/package.json ./packages/persona-client/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/solana-utils/node_modules ./packages/solana-utils/node_modules
COPY --from=deps /app/packages/persona-client/node_modules ./packages/persona-client/node_modules
COPY . .
RUN pnpm --filter @41rpm/shared build && \
    pnpm --filter @41rpm/solana-utils build && \
    pnpm --filter @41rpm/persona-client build && \
    pnpm --filter @41rpm/api build

# --- Production ---
FROM node:20-slim AS runner
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

# Install Chromium and dependencies for Stagehand/Playwright + ffmpeg
# (ffmpeg is used by services/video.ts to encode CDP screencast JPEG
# sequences into 854×480 @ 5fps webm replays for /report/<id>)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-noto-cjk \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/solana-utils/node_modules ./packages/solana-utils/node_modules
RUN cd node_modules/bigint-buffer && npm rebuild 2>/dev/null || true
COPY --from=deps /app/packages/persona-client/node_modules ./packages/persona-client/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/solana-utils/dist ./packages/solana-utils/dist
COPY --from=build /app/packages/persona-client/dist ./packages/persona-client/dist
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/solana-utils/package.json ./packages/solana-utils/
COPY packages/persona-client/package.json ./packages/persona-client/
COPY package.json pnpm-workspace.yaml ./

EXPOSE 4100
CMD ["node", "apps/api/dist/index.js"]
