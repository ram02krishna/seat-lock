<<<<<<< HEAD
# Build from the repository root:  docker build -f apps/api/Dockerfile .
# (docker-compose.yml does this for you.)

# ---- Base ----------------------------------------------------------------------------------
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Prisma needs OpenSSL on Alpine
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

# ---- Build ---------------------------------------------------------------------------------
FROM base AS builder
# Manifests and the lockfile first, so the dependency layer is cached until they change.
# apps/web/package.json is only here so the workspace matches the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
# The API's postinstall step runs `prisma generate`, which needs the schema to already be present.
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm install --frozen-lockfile --filter "api..."

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @repo/shared build && pnpm --filter api build

# ---- Run -----------------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

WORKDIR /app/apps/api
EXPOSE 4000
# Apply pending database migrations, then start the API.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/index.js"]
=======
# Stage 1: Base
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Stage 2: Build
FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile=false

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @repo/shared build
RUN pnpm --filter api build

# Stage 3: Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
