FROM node:20-alpine AS base
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache python3 make g++ pkgconf pixman-dev cairo-dev pango-dev jpeg-dev giflib-dev
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/queue/package.json ./packages/queue/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --shamefully-hoist

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# Copy entire node_modules tree (shamefully-hoist puts everything at root)
COPY --from=deps /app/ ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm --filter @slideforge/db run generate
RUN pnpm --filter @slideforge/db run build
RUN pnpm --filter @slideforge/queue run build
RUN pnpm --filter @slideforge/shared run build
WORKDIR /app/apps/web
RUN mkdir -p .next/cache/webpack .next/server
RUN pnpm build

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
