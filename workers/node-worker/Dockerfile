FROM node:20-alpine AS base
# poppler-utils provides pdftoppm — the thumbnail generator now does
# PPTX → soffice PDF → pdftoppm one-PNG-per-page (LibreOffice's direct
# PNG converter only emits the first slide, which is why prod thumbnails
# were 1-per-deck regardless of slide count).
RUN apk add --no-cache libreoffice poppler-utils font-noto openssl
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY workers/node-worker/package.json ./workers/node-worker/
COPY packages/db/package.json ./packages/db/
COPY packages/queue/package.json ./packages/queue/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --shamefully-hoist

FROM base AS builder
COPY --from=deps /app/ ./
COPY workers/node-worker ./workers/node-worker
COPY packages ./packages
RUN pnpm --filter @slideforge/db run generate
RUN pnpm --filter @slideforge/db run build
RUN pnpm --filter @slideforge/queue run build || true
RUN pnpm --filter @slideforge/shared run build || true
WORKDIR /app/workers/node-worker
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/workers/node-worker/dist ./dist
COPY --from=builder /app/workers/node-worker/node_modules ./workers/node-worker/node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/workers/node-worker/package.json ./package.json
CMD ["node", "dist/index.js"]
