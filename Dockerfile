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

# Force HTTP transport inside the container so the HEALTHCHECK below
# (which probes http://localhost:8080/healthz) can actually reach a listener.
# src/core/transport/select.ts defaults to stdio when MCP_TRANSPORT is unset,
# and stdio never binds any port — making the HEALTHCHECK impossible to
# satisfy. The MCP_Market_Distribution pipeline's Track A Layer 3 gate
# expects the container to reach HEALTHCHECK=healthy within 60s.
ENV MCP_TRANSPORT=http
ENV PORT=8080
# Bind all interfaces inside the container (host default is 127.0.0.1); the
# container runtime provides network isolation. Required so EXPOSE/HEALTHCHECK work.
ENV MCP_HTTP_HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
