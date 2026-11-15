# Vercel Deployment Guide

This monorepo is fully configured and ready to deploy on [Vercel](https://vercel.com).

---

## Architecture Overview

- **Frontend (`apps/web`)**: Next.js 15 (React 19, TailwindCSS, Socket.IO Client, TanStack Query).
  - Designed for hosting on **Vercel**.
- **Backend API (`apps/api`)**: Node.js / Express with WebSocket (`Socket.IO`), BullMQ workers, Redis, and PostgreSQL (Prisma).
  - Stateful server requiring long-running processes (WebSockets & BullMQ workers).
  - Recommended hosting on platforms like **Render**, **Railway**, **Fly.io**, or any VPS / Docker host.

---

## Step 1: Deploy Frontend (`apps/web`) to Vercel

### Method A: Via Vercel Dashboard (Recommended)

1. Push your repository to GitHub / GitLab / Bitbucket.
2. Go to [Vercel Dashboard](https://vercel.com/new) and click **"Add New Project"**.
3. Import your repository: `seat-lock`.
4. In the **Project Configuration** screen:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: Click *Edit* and select `apps/web`.
   - **Build and Output Settings**:
<<<<<<< HEAD
     - *Build Command*: Leave the default (`next build`); the `prebuild` hook in `apps/web/package.json` builds `@repo/shared` first.
     - *Install Command*: Leave the default (`pnpm install`).
=======
     - *Build Command*: Leave default or set `pnpm --filter @repo/shared build && next build` (a `prebuild` hook is also built-in to `apps/web/package.json`).
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
     - *Output Directory*: Automatically detects `.next`.
5. Under **Environment Variables**, add:
   | Variable | Value | Description |
   | :--- | :--- | :--- |
   | `NEXT_PUBLIC_API_URL` | `https://your-api-domain.com` | Production URL of your deployed Express API |
   | `NEXT_PUBLIC_SOCKET_URL` | `https://your-api-domain.com` | WebSocket endpoint URL (same as API server) |
6. Click **Deploy**.

---

### Method B: Deploy from Repository Root (`/`)

If you prefer leaving the Vercel Root Directory set to `./` (root of the monorepo):
- The repository includes a root [vercel.json](./vercel.json) that automatically routes the build to `apps/web`:
  - `buildCommand`: `pnpm --filter @repo/shared build && pnpm --filter web build`
  - `outputDirectory`: `apps/web/.next`

---

## Step 2: Configure Backend (`apps/api`)

To connect your deployed Vercel frontend with the backend API:

1. **Set `CLIENT_URL` on the API server**:
   ```env
   CLIENT_URL=https://your-app.vercel.app
   ```
   > **Tip**: You can provide a comma-separated list to support multiple domains and preview builds, e.g.:
   > `CLIENT_URL=http://localhost:3000,https://your-app.vercel.app`
   > Add each trusted preview deployment URL explicitly. The API intentionally does not wildcard-allow all `*.vercel.app` origins because authentication uses credentialed cookies.

2. **Cross-Site Authentication Cookies**:
<<<<<<< HEAD
   - In production the auth routes set `SameSite=None` and `Secure`, so the browser sends the session cookie from `your-app.vercel.app` to `your-api.onrender.com`.
   - Some browsers (notably Safari) block third-party cookies. For the most reliable sign-in, serve the web app and the API from subdomains of the same domain (for example `app.example.com` and `api.example.com`).
=======
   - The auth routes have been updated to set `SameSite: 'None'` and `Secure: true` when `NODE_ENV=production`.
   - This ensures the browser sends the authentication cookie across domains (`your-app.vercel.app` -> `your-api.onrender.com`).
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

3. **Backend Environment Variables**:
   ```env
   NODE_ENV=production
   PORT=4000
   CLIENT_URL=https://your-app.vercel.app
   DATABASE_URL=postgresql://user:password@host:5432/event_db?sslmode=require
   REDIS_URL=rediss://default:password@host:6379
   JWT_SECRET=replace-with-a-random-secret-of-at-least-32-characters
   ORGANIZER_EMAIL=organizer@yourdomain.com
   ORGANIZER_PASSWORD=replace-with-a-unique-password-of-at-least-8-characters
   RESEND_API_KEY=re_your_resend_key
   RESEND_FROM_EMAIL=SeatLock <tickets@your-verified-domain.com>
   ```

<<<<<<< HEAD
4. **Build and start commands** (Render, Railway, Fly.io or a VPS; run from the repository root):
   ```bash
   # Build
   pnpm install --frozen-lockfile && pnpm build:api
   # Start: apply database migrations, then run the API
   pnpm db:deploy && pnpm start:api
   ```
   Or build the Docker image: `docker build -f apps/api/Dockerfile -t seat-lock-api .` (it applies the migrations on start).
   Do **not** run `pnpm db:seed` against a production database; it erases data and refuses to run when `NODE_ENV=production`.

=======
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
---

## Step 3: Local Verification

You can verify the production build locally anytime by running:

```bash
# Build the Next.js web application
<<<<<<< HEAD
pnpm build:web

# Or build the entire monorepo (shared, API and web)
pnpm build
=======
pnpm run build:web

# Or build the entire monorepo
pnpm run build
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
```
