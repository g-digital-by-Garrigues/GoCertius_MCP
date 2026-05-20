FROM node:22-slim AS base
WORKDIR /app

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mcpuser

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

USER mcpuser

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
