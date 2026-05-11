FROM node:20-alpine AS base
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY workers/mcp-server/package.json ./workers/mcp-server/
RUN pnpm install --frozen-lockfile --shamefully-hoist --filter @slideforge/mcp-server...

FROM base AS builder
COPY --from=deps /app/ ./
COPY workers/mcp-server ./workers/mcp-server
WORKDIR /app/workers/mcp-server
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/workers/mcp-server/dist ./dist
COPY --from=builder /app/workers/mcp-server/node_modules ./workers/mcp-server/node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/workers/mcp-server/package.json ./package.json
EXPOSE 8200
CMD ["node", "dist/index.js"]
