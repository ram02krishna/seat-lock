# Build from the repository root:  docker build -f apps/web/Dockerfile .
# (docker-compose.yml does this for you.)

# ---- Base ----------------------------------------------------------------------------------
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- Build ---------------------------------------------------------------------------------
FROM base AS builder
# apps/api/package.json is only here so the workspace matches the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --filter "web..."

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so they must be
# passed as build arguments (docker-compose.yml does this).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL

RUN pnpm --filter @repo/shared build && pnpm --filter web build

# ---- Run -----------------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/next.config.mjs ./apps/web/next.config.mjs

WORKDIR /app/apps/web
EXPOSE 3000
# Call next directly: going through pnpm would try to download pnpm again at container start.
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
