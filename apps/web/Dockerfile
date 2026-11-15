<<<<<<< HEAD
# Build from the repository root:  docker build -f apps/web/Dockerfile .
# (docker-compose.yml does this for you.)

# ---- Base ----------------------------------------------------------------------------------
=======
# Stage 1: Base
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
<<<<<<< HEAD
WORKDIR /app

# ---- Build ---------------------------------------------------------------------------------
FROM base AS builder
# apps/api/package.json is only here so the workspace matches the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --filter "web..."
=======

# Stage 2: Build
FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile=false
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

<<<<<<< HEAD
# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so they must be
# passed as build arguments (docker-compose.yml does this).
=======
# NEXT_PUBLIC_* values are baked into the client bundle at build time
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL

<<<<<<< HEAD
RUN pnpm --filter @repo/shared build && pnpm --filter web build

# ---- Run -----------------------------------------------------------------------------------
FROM base AS runner
=======
RUN pnpm --filter @repo/shared build
RUN pnpm --filter web build

# Stage 3: Runner
FROM base AS runner
WORKDIR /app
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
<<<<<<< HEAD
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
=======
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules

EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
