FROM node:22-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM base AS build
COPY . .
RUN npm ci
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mcpuser

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

USER mcpuser

# Force HTTP transport inside the container so the Dockerfile's HEALTHCHECK
# (which probes http://localhost:8080/healthz) can actually reach a listener.
# The MCP defaults to stdio (src/core/transport/select.ts) which never binds
# any port; without this env, Track A Layer 3 of the publish pipeline times
# out at 60s waiting for the container to become 'healthy'.
ENV MCP_TRANSPORT=http
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
