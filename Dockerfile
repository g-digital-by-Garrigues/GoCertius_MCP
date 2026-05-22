FROM node:22-alpine AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runner
WORKDIR /app

# Patch OS packages to fix CVEs disclosed after the base image was built.
RUN apk update && apk upgrade --no-cache

# Update bundled npm so its transitive deps (e.g. picomatch) are at patched
# versions. node:22-alpine ships npm 10.x flagged HIGH by Docker Scout.
RUN npm install -g npm@latest && npm cache clean --force

RUN addgroup -S nodejs && adduser -S mcpuser -G nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

USER mcpuser

ENV MCP_TRANSPORT=http
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["node", "dist/server.js"]
