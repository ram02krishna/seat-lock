# Concurrency-Safe Event Ticketing with an Interactive Seat Map

<<<<<<< HEAD
A full-stack, concurrency-safe event ticketing platform built to handle flash-sale traffic spikes, interactive SVG venue seating, multi-showtime cinema scheduling, and venue gate turnstile check-in with zero double bookings.

Designed and built as a high-performance system showcasing atomic raw-SQL seat holds, real-time WebSocket synchronization, delayed worker queues and cinema multi-showtime management.
=======
A production-ready, full-stack, concurrency-safe event ticketing platform built to handle flash-sale traffic spikes, interactive SVG venue seating, multi-showtime cinema scheduling, and venue gate turnstile check-in with zero double bookings.

Designed and built as a high-performance system showcasing transaction isolation, raw SQL atomic locking, real-time WebSocket synchronization, delayed worker queues, cinema multi-showtime management, and high-concurrency load testing.
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

---

## The Problem

High-demand ticket sales (concerts, sports, festivals, movie premieres) suffer from a classic distributed systems challenge: **extreme contention on shared state**. 

When thousands of users click the same seat at the exact same millisecond:
1. **Double-Booking**: Naive implementations read seat state, verify availability in application memory, and then write. Under concurrent traffic, multiple users read "available" simultaneously, creating double bookings.
<<<<<<< HEAD
2. **Deadlocks**: Users selecting multiple seats in a different order (e.g., User A selects `[1, 2]`, User B selects `[2, 1]`) can lock rows in opposite order and deadlock the database.
=======
2. **Deadlocks**: Users selecting multiple seats in different order (e.g., User A selects `[1, 2]`, User B selects `[2, 1]`) can lock rows in opposite order, crashing the database with circular deadlocks.
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
3. **Cart Abandonment**: If users hold seats but never complete payment, seats stay locked forever unless released by an authoritative background scheduler.
4. **Gate Turnstile Race Conditions**: Fraudsters duplicating QR codes can try to scan through two venue turnstiles at the same instant.
5. **Multi-Showtime Schedule Inconsistencies**: Movie theaters running multiple shows per day require isolated seat inventories per showtime while preserving chronological date and time sorting from morning to night.

<<<<<<< HEAD
This project solves these problems with database-level atomicity, deterministic seat ordering, BullMQ delayed workers, conditional gate check-in, and per-show seat inventories.
=======
This project solves these problems with database-level atomicity, deterministic lock ordering, BullMQ delayed workers, conditional gate check-in, and chronological multi-show management.
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

---

## Architecture

```
                       +---------------------------------------+
                       |          Next.js App Router           |
                       |  - Interactive SVG Seat Map           |
                       |  - Multi-Showtime Cinema Selector     |
                       |  - Server-Authoritative Hold Timer    |
                       |  - Real-Time Socket.IO Client         |
                       |  - Event-Wise Ticket Print Engine     |
                       |  - Staff Camera Turnstile Scanner     |
                       +-------------------+-------------------+
                                           |
                               HTTP / WebSocket (Port 4000)
                                           |
                                           v
                       +---------------------------------------+
                       |           Express API Server          |
                       |  - Zod Input Validation               |
                       |  - JWT HttpOnly Cookie Auth           |
                       |  - Socket.IO Per-Event Rooms          |
                       |  - Resend Email Service (IST Timezone)|
                       |  - Cinema Show Scheduler (Sorted)     |
                       +---------+-------------------+---------+
                                 |                   |
               Atomic $queryRaw  |                   | Delayed Jobs
               Row-Level Locks   |                   |
                                 v                   v
            +---------------------------+   +-------------------+
            |        PostgreSQL         |   |   Redis (BullMQ)  |
            |  - EventSeat (Unique idx) |   |  - 5-Min Expiry   |
            |  - Multi-Showtime Show    |   |  - 60s Sweeper    |
            |  - Atomic UPDATE ...      |   |  - Micro-Caching  |
            |  - Ticket QR Tokens       |   +-------------------+
            +---------------------------+
```

---

## Technical Deep Dive: The Concurrency Engine

<<<<<<< HEAD
### 1. Deterministic ordering and one statement per hold
When a user holds several seats, the IDs are de-duplicated and sorted before the database is touched:
```ts
const sortedIds = [...new Set(seatIds)].sort();
```
The hold itself is a single conditional `UPDATE` (below), and each user's holds are serialised with a `SELECT ... FOR UPDATE` on their `User` row, so two requests from the same user can never leave them holding seats at two events.

### 2. Atomic conditional seat hold
Instead of reading with `findFirst()` and writing later, the hold runs one atomic conditional `UPDATE` inside a Prisma transaction (`apps/api/src/services/hold.service.ts`):
```sql
UPDATE "EventSeat"
SET status = 'HELD', "heldByUserId" = $user, "holdExpiresAt" = $expires,
    version = version + 1, "updatedAt" = NOW()
WHERE "eventId" = $event
  AND "showId" = $show                       -- only for cinema events
  AND ("seatId" IN ($ids) OR id IN ($ids))
  AND (
    status = 'AVAILABLE'
    OR (status = 'HELD' AND ("holdExpiresAt" < NOW() OR "heldByUserId" = $user))
  )
RETURNING id, "seatId", price;
```
- PostgreSQL takes row-level write locks on the matching rows, so the first concurrent transaction wins and every other one matches 0 rows for those seats.
- A seat is takeable when it is `AVAILABLE`, its hold has expired, or it is already held by the same user (re-selecting or extending a hold).

### 3. All-or-nothing
If a user asks for 3 seats and only 2 were acquired, the transaction throws `409 Conflict` and rolls back, so nobody ends up with a partial cart:
=======
### 1. Deadlock Prevention via Deterministic Sorting
When a user holds multiple seats, we deduplicate and sort seat IDs alphabetically before touching the database:
```ts
const sortedIds = [...new Set(seatIds)].sort();
```
If User A requests seats `[A2, A1]` and User B requests `[A1, A2]`, both transactions attempt to acquire row locks in the exact same alphabetical order (`A1` then `A2`). Circular lock wait conditions become mathematically impossible.

### 2. Atomic Conditional Seat Hold
Instead of reading with `findFirst()` and writing later, we run a single atomic conditional SQL `UPDATE` inside a Prisma transaction:
```sql
UPDATE "EventSeat"
SET 
  status = 'HELD',
  "heldByUserId" = $1,
  "holdExpiresAt" = $2,
  version = version + 1,
  "updatedAt" = NOW()
WHERE "eventId" = $3
  AND ("seatId" IN ($4) OR id IN ($4))
  AND (
    status = 'AVAILABLE'
    OR (status = 'HELD' AND "holdExpiresAt" < NOW())
  )
RETURNING id, "seatId", price;
```
- PostgreSQL acquires exclusive row-level write locks on the matching rows.
- The condition checks that seats are either `AVAILABLE` or have an expired hold timestamp.
- The first concurrent transaction gets the rows. All other concurrent transactions evaluate `status = 'AVAILABLE'` as false and return 0 rows.

### 3. All-or-Nothing Transaction Rollback
If a user requests 3 seats and only 2 were acquired (because a competitor claimed the 3rd seat a fraction of a millisecond earlier), the transaction throws an `HTTP 409 Conflict`:
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
```ts
if (updatedRows.length !== sortedIds.length) {
  throw new AppError(409, 'One or more selected seats are no longer available');
}
```
<<<<<<< HEAD

### 4. Hold expiry: BullMQ + a database sweeper
- After a hold, a delayed BullMQ job (5 minutes) is queued. If the seats are still held and expired when it runs, they go back to `AVAILABLE` and a `seats:released` Socket.IO event updates every open seat map.
- A 60-second periodic job runs the same conditional release for any expired hold the worker missed (for example after a restart). With `REDIS_URL=mock` only this sweeper runs.
- The database is the source of truth: every query treats an expired hold as available, even before it is swept.

### 5. Idempotent checkout
`POST /api/orders/confirm` accepts an `idempotencyKey`. Replaying the same key returns the original order instead of creating a second one, including when two identical requests race.

### 6. Atomic gate check-in
Two scanners reading the same QR code at once cannot both succeed:
```sql
UPDATE "Ticket"
SET "checkedInAt" = NOW(), "updatedAt" = NOW()
WHERE id = $1 AND "checkedInAt" IS NULL
RETURNING id, "checkedInAt";
```
The loser gets 0 rows and a `409 Ticket already used`.

---

## Cinema Multi-Showtime System

Cinema events (`THEATER_DOLBY` layout) are scheduled by **showtimes**:

- Each show has its **own seat inventory** (`AVAILABLE` / `HELD` / `SOLD`) and its own **tier prices** (VIP, Premium, Standard).
- The seat picker groups shows by date (Today, Tomorrow, then weekday/day/month), sorted earliest first, and defaults to the next upcoming show.
- Each showtime shows a status indicator: Available, Selling fast or Sold out.
- A show with sold tickets cannot be deleted; moving it asks for confirmation and emails the ticket holders.

All other venue types (conference hall, auditorium, concert arena, other) have a single start time.

---

## Tickets and Printing

On **My tickets** (`/my-tickets`) every order has its own **Print tickets** button, which prints only that order's tickets with print-specific styles, one QR code per seat. A ticket code can be copied for manual entry at the gate.
=======
The database rolls back automatically. A user never ends up with a partial cart.

### 4. BullMQ & Redis Delayed Auto-Release
Once seats are held, a delayed job is pushed to BullMQ with a 5-minute delay:
- If the user confirms and pays, the hold converts to `SOLD` and the order is finalized.
- If the user abandons checkout, the BullMQ worker runs, releases the seats back to `AVAILABLE`, and emits a `seats:released` event via Socket.IO to notify all browsing clients instantly.
- A secondary 60-second periodic cleanup job catches any edge cases if the worker restarts.

### 5. Atomic Gate Turnstile Check-In
To prevent duplicated QR codes from scanning at two doors simultaneously:
```sql
UPDATE "Ticket"
SET "checkedInAt" = NOW()
WHERE id = $1 AND "checkedInAt" IS NULL
RETURNING id, "checkedInAt";
```
If two scanners submit the same QR token concurrently, only the first query updates a row. The second query returns 0 rows and immediately fails with `409 Conflict ("Ticket already scanned at [time]")`, triggering an audible alert on the staff device.

---

## Cinema Multi-Showtime System (BookMyShow Experience)

For cinema auditoriums and theaters (`THEATER_DOLBY`), events feature multiple showtimes per day:

1. **Strict Chronological Sorting by Date and Time**:
   - Show dates are organized into chronological selector tabs (`Today`, `Tom`, weekday/day/month).
   - Within each date, showtimes are strictly sorted in ascending chronological order from morning to afternoon to night (e.g. `9:50 am` → `10:30 am` → `12:30 pm` → `10:30 pm`).
   - Default showtime selection automatically picks the earliest upcoming available show.
2. **Independent Seat Inventories & Layouts**:
   - Each showtime has its own full seat map and independent seat states (`AVAILABLE`, `HELD`, `SOLD`).
   - Custom tier pricing overrides per showtime (`VIP`, `PREMIUM`, `STANDARD`).
3. **Live Availability Telemetry**:
   - Shows badge counts and real-time status indicators (`Available`, `Selling fast`, `Sold out`).

---

## Event-Wise Ticket Printing & Physical Gate Passes

On the **My Tickets** portal (`/my-tickets`), ticket printing is isolated on an individual event basis:
- **Event-Specific Print Buttons**: Every order card features a dedicated `Print tickets` action. Clicking it isolates **only** that event's tickets, preventing other orders from spilling onto paper.
- **Dynamic Venue & Location**: Displays both the Venue Name and exact Street Address/Location dynamically.
- **Professional Print Styles**: Utilizes CSS `@page`, `print-color-adjust: exact`, high-resolution QR codes, individual ticket codes, gate scan instructions, and `page-break-inside: avoid` to prevent awkward cutoffs across sheets.

---

## Concurrency Stress Benchmark

The concurrency engine was benchmarked with 1,000 rapid concurrent hold requests from 200 distinct virtual users racing simultaneously for a pool of 50 seats.

### Benchmark Results
| Metric | Value | Meaning |
|---|---|---|
| **Total Requests** | `1,000` | Rapid concurrent hold requests |
| **Successful Holds** | `37` | Users who successfully secured seat batches |
| **Conflicts Handled** | `963` | Graceful `409 Conflict` responses |
| **5xx Server Errors** | **`0`** | Zero crashes, unhandled rejections, or deadlocks |
| **Throughput** | **`900.9 req/sec`** | Sub-second high-load capacity |
| **Latency p50** | `30ms` | Median response time |
| **Latency p95** | `66ms` | 95th percentile response time |
| **Duplicate Seat Holds** | **`0`** | Verified via direct SQL group-by audit |
| **Duplicate Tickets** | **`0`** | Verified via database ticket audit |
| **Result** | **PASSED** | 100% sound concurrency safety |
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

---

## Tech Stack

| Category | Technology |
|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Framer Motion, Zustand, TanStack Query, Socket.IO Client, html5-qrcode |
<<<<<<< HEAD
| **Backend** | Node.js 20, Express, TypeScript, Zod, JWT (httpOnly cookies), Socket.IO, BullMQ, Redis, Pino, Resend, QRCode |
| **Database** | PostgreSQL 16, Prisma ORM with raw atomic `$queryRaw` statements |
| **Tooling** | pnpm workspaces, Docker (multi-stage) + Docker Compose, GitHub Actions |
=======
| **Backend** | Node.js, Express, TypeScript, Zod, JWT (httpOnly cookies), Socket.IO, BullMQ, Redis, Pino, Resend SDK, QRCode |
| **Database** | PostgreSQL 16, Prisma ORM with raw atomic `$queryRaw` transactions |
| **DevOps & CI** | Docker (multi-stage), Docker Compose, GitHub Actions (Postgres & Redis service containers) |
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

---

## Repository Structure

```
seat-lock/
├── apps/
<<<<<<< HEAD
│   ├── api/                      # Express backend
│   │   ├── prisma/               # schema.prisma, migrations/, seed.ts
│   │   ├── scripts/              # check-seat-layout.ts, clean-db.ts
│   │   └── src/
│   │       ├── jobs/             # BullMQ expiry queue/worker, periodic cleanup
│   │       ├── middleware/       # auth + roles, rate limit, Zod validation
│   │       ├── routes/           # auth, events, orders, tickets, organizer
│   │       ├── services/         # holds, orders, event/show management, seat layout, email
│   │       └── app.ts, index.ts, socket.ts, redis.ts, config.ts ...
│   └── web/                      # Next.js frontend
│       └── src/
│           ├── app/              # events/[id], checkout, my-tickets, organizer, staff/scanner, login
│           ├── components/       # seat map, cart panel, show selector/manager, navbar ...
│           ├── hooks/            # countdown, live socket updates
│           ├── lib/, store/      # helpers, Zustand cart store
├── packages/shared/              # Zod schemas and types shared by api and web
├── docker-compose.yml
└── .github/workflows/ci.yml
=======
│   ├── api/                    # Express backend
│   │   ├── prisma/             # Schema, migrations, seed script
│   │   ├── src/
│   │   │   ├── jobs/           # BullMQ expiry worker & cleanup sweeper
│   │   │   ├── middleware/     # Auth, role check, validation
│   │   │   ├── routes/         # Auth, events, hold, orders, tickets, organizer
│   │   │   ├── services/       # Atomic hold SQL, order finalization, Resend email
│   │   │   ├── socket.ts       # Socket.IO room broadcaster
│   │   │   └── app.ts          # Express application setup
│   │   └── scripts/            # Database reset/cleanup utility
│   │
│   └── web/                    # Next.js frontend
│       └── src/
│           ├── app/
│           │   ├── events/[id] # Event details, multi-showtime selector & SVG seat map
│           │   ├── checkout/   # Checkout with server-authoritative timer
│           │   ├── my-tickets/ # Event-wise ticket wallet & print engine
│           │   ├── organizer/  # Real-time analytics, revenue, capacity, multi-show manager
│           │   ├── staff/      # Turnstile camera scanner UI (html5-qrcode)
│           │   └── login/      # Auth screen with 1-click demo logins & OTP recovery
│           ├── components/     # SVG seat map, CinemaShowSelector, ShowManager, Navbar
│           └── store/          # Zustand cart store
│
├── packages/
│   └── shared/                 # Zod validation schemas and shared TypeScript types
│
└── .github/workflows/          # CI pipeline with PostgreSQL and Redis containers
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
```

---

## Getting Started

<<<<<<< HEAD
**Prerequisites:** Node.js 20+, [pnpm 10](https://pnpm.io/installation) (`corepack enable` picks up the exact version from `package.json`), and either PostgreSQL 14+ **or** Docker.

Pick one of the three setups. All of them end with the app at **http://localhost:3000** (or **:3001** for the full Docker stack).

### Option 1 - Without Docker

You need a PostgreSQL database. Redis is optional (an in-memory mock is built in).

```bash
git clone https://github.com/ram02krishna/seat-lock.git
cd seat-lock
pnpm install                 # also generates the Prisma client
cp .env.example .env
```

Edit `.env` and set:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/seat_lock?schema=public   # your PostgreSQL
REDIS_URL=mock                                                                        # no Redis needed
```
(A free cloud PostgreSQL such as Neon or Supabase works too; use its connection string.)

Create the database, create the tables, load the demo data and start everything:
```bash
createdb seat_lock           # or: psql -U postgres -c 'CREATE DATABASE seat_lock;'
pnpm db:deploy               # apply the migrations
pnpm db:seed                 # demo events and users (erases existing data!)
pnpm dev                     # API on :4000 and web on :3000
```
To run only one side: `pnpm dev:api` or `pnpm dev:web`.

### Option 2 - Docker for PostgreSQL and Redis, apps on your machine

=======
### 1. Clone & Install
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
```bash
git clone https://github.com/ram02krishna/seat-lock.git
cd seat-lock
pnpm install
<<<<<<< HEAD
cp .env.example .env         # the defaults already match the Docker containers
docker compose up -d         # PostgreSQL on :5433, Redis on :6379   (or: pnpm docker:infra)
pnpm db:deploy
pnpm db:seed
pnpm dev
```

### Option 3 - Everything in Docker

No Node.js or pnpm needed on your machine.

```bash
git clone https://github.com/ram02krishna/seat-lock.git
cd seat-lock
docker compose --profile app up -d --build     # or: pnpm docker:full
docker compose --profile seed run --rm seed    # demo data, run once the API is up (or: pnpm docker:seed)
```
- Web: http://localhost:3001
- API: http://localhost:4000 (health check: http://localhost:4000/health)

The API container applies the database migrations every time it starts. Stop everything with `docker compose --profile app down` (add `-v` to also delete the database volume), or `pnpm docker:down`.

Change host ports with `POSTGRES_PORT`, `REDIS_PORT`, `DOCKER_API_PORT` and `DOCKER_WEB_PORT` (in `.env` or the shell). The Docker setup uses development-mode settings over plain `http://localhost`; it is not a production configuration.

### Demo accounts (created by the seed)

| Role | Email | Password |
|---|---|---|
| Organizer | `organizer@eventseat.com` | `password123` |
| Staff | `staff@eventseat.com` | `password123` |
| Customer | `customer@eventseat.com` | `password123` |

The seed creates four events: a cinema (60 seats, three showtimes), a conference hall (150), an auditorium (240) and a concert arena (400). Even without seeding, the API creates the organizer account on start-up if no organizer exists (`ORGANIZER_EMAIL` / `ORGANIZER_PASSWORD`).

New customers register with an emailed 6-digit code. In development (`NODE_ENV` is not `production`) the API also returns the code in its response and prints it in the API log, so no email provider is needed.

---

## Common Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `dev:api` / `dev:web` | Run API + web, or just one of them, with hot reload |
| `pnpm build` | Build the shared package, API and web app |
| `pnpm start:api` / `pnpm start:web` | Run the production builds (after `pnpm build`) |
| `pnpm typecheck` | Type-check shared, API and web |
| `pnpm check:layout` | Run the seat-layout generator checks (no database needed) |
| `pnpm db:generate` | Regenerate the Prisma client after editing `schema.prisma` |
| `pnpm db:migrate` | Create a new migration while developing (`prisma migrate dev`) |
| `pnpm db:deploy` | Apply existing migrations (use this for fresh and production databases) |
| `pnpm db:push` | Sync the schema without a migration (quick local experiments only) |
| `pnpm db:seed` | Load demo data. **Deletes all existing users, events and orders.** Refuses to run in production |
| `pnpm db:clean` | Delete all users, orders and tickets and release every seat |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm docker:infra` / `docker:full` / `docker:seed` / `docker:down` | The Docker commands from above |

After changing `schema.prisma`, run `pnpm db:migrate` and commit the new migration folder; CI applies the migrations to a clean database.

---

## Environment Variables

The full list with comments is in [`.env.example`](./.env.example). The ones you will touch most:

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | API, Prisma | PostgreSQL connection string (required) |
| `REDIS_URL` | API | Redis URL, or `mock` for an in-memory Redis (development only) |
| `JWT_SECRET` | API | Session signing key; must be unique and 32+ characters in production |
| `CLIENT_URL` | API | Comma-separated exact frontend origins allowed by CORS |
| `ORGANIZER_EMAIL`, `ORGANIZER_PASSWORD` | API | Organizer account created on first start |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | API | Email delivery (required in production) |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL` | Web | Where the browser finds the API (default `http://localhost:4000`; set in `apps/web/.env`) |
=======
```
The API generates Prisma Client during installation. If you change the Prisma schema later, regenerate it with `pnpm --filter api prisma:generate`.

### 2. Environment Variables
Copy `.env.example` to `.env` in the project root:
```bash
cp .env.example .env
```

Configure your `DATABASE_URL` and `REDIS_URL`:

**Option A — Running Without Docker:**
```env
# Local native PostgreSQL (port 5432) or free cloud PostgreSQL (e.g. Neon / Supabase):
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/seat_lock?schema=public"

# Built-in in-memory mock Redis (zero external dependencies or Docker needed!):
REDIS_URL="mock"

JWT_SECRET="supersecretdevkey1234567890_min32chars"
```

**Option B — Running With Docker Infrastructure:**
```env
# Port 5433 mapped by docker compose:
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/seat_lock?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="supersecretdevkey1234567890_min32chars"
```

### 3. Database Schema Push & Seed
Push the Prisma schema to your database and populate the seed data (Grand Symphony Hall, 112 seats across VIP, Premium, and Standard tiers, plus sample events):
```bash
pnpm db:push      # Push Prisma schema directly to your database (or: pnpm db:migrate)
pnpm db:seed      # Populate seed data and default organizer account (or: pnpm seed)
```

### 4. Run Development Servers
```bash
# Starts API (port 4000) and Web (port 3000) concurrently:
pnpm dev

# Or start only the Backend API server:
pnpm dev:api      # or: pnpm dev:backend

# Or start only the Frontend Web app:
pnpm dev:web
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Running with Docker

### 1. Database & Cache Infrastructure Only (Recommended for Local Dev)
When running your Next.js and Express apps locally with hot-reload via `pnpm dev`:
```bash
docker compose up -d    # or: pnpm db:up
```
This spins up only `event_booking_postgres` (port 5432) and `event_booking_redis` (port 6379), completely avoiding port collisions with your local dev server.

### 2. Full Containerized Stack (Postgres, Redis, Express API, Next.js Web)
To run the entire platform inside Docker containers:
```bash
docker compose --profile app up -d --build   # or: pnpm docker:full
```
- Web: [http://localhost:3001](http://localhost:3001)
- API: [http://localhost:4000](http://localhost:4000)

To stop all containers:
```bash
docker compose down   # or: pnpm db:down
```
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

---

## Role Hierarchy & Access Control

<<<<<<< HEAD
| Role | How it is created | Can do |
|---|---|---|
| **ORGANIZER** | The single account created at API start-up (or by the seed) | Use the `/organizer` dashboard: create, edit and delete their own events, manage cinema showtimes and tier prices, see revenue and occupancy, create and remove staff accounts |
| **STAFF** | Created by the organizer in the dashboard | Use `/staff/scanner` (camera QR scanner or manual code entry) to check tickets in |
| **CUSTOMER** | Self-registration on `/login` | Browse events, pick showtimes and seats, hold seats for 5 minutes, check out, view and print tickets |
=======
| Role | Provisioning | Default / Access | Permissions & Features |
|---|---|---|---|
| **ORGANIZER** | **Single Administrative Account** | `organizer@eventseat.com`<br>*(Password: `password123`)* | Access `/organizer` dashboard, view live revenue & occupancy analytics, create events & venues, schedule multiple showtimes, manage ticket pricing tiers, and provision staff accounts |
| **STAFF** | **Created Exclusively by Organizer** | Provisioned via `/organizer` dashboard | Access `/staff/scanner` live camera QR code turnstile scanner, manual UUID validation, and real-time check-in |
| **CUSTOMER** | **Public Self-Registration** | Self-signup via `/login` (Register tab) | Browse events, select cinema dates & showtimes, interact with live SVG seat map, hold seats for 5 mins, checkout, view/print digital tickets with QR passes |
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

---

## Key API Endpoints

<<<<<<< HEAD
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/health` | Liveness (`?deep=true` also checks PostgreSQL and Redis) | Public |
| `POST` | `/api/auth/register/send-otp` | Send a 6-digit signup code | Public |
| `POST` | `/api/auth/register/verify-otp` | Verify the code and create the customer account | Public |
| `POST` | `/api/auth/login` | Sign in (sets an httpOnly cookie) | Public |
| `POST` | `/api/auth/forgot-password` | Send a password-reset code | Public |
| `POST` | `/api/auth/reset-password` | Verify the code and set a new password | Public |
| `POST` | `/api/auth/logout` | Clear the session cookie | Public |
| `GET` | `/api/auth/me` | Current user | Signed in |
| `GET` | `/api/events` | Upcoming published events (cached for 5 s) | Public |
| `GET` | `/api/events/:id` | One event with its showtimes | Public |
| `GET` | `/api/events/:id/seats?showId=` | Seat map with live availability | Public |
| `GET` | `/api/events/active-hold` | The signed-in user's current hold, if any | Public (empty when signed out) |
| `POST` | `/api/events/:id/hold` | Atomically hold seats for 5 minutes | Signed in |
| `POST` | `/api/events/:id/release` | Release held seats | Signed in |
| `POST` | `/api/orders/confirm` | Confirm held seats, create tickets, send the email | Signed in |
| `GET` | `/api/orders/my-tickets` | The user's confirmed orders with QR codes | Signed in |
| `POST` | `/api/tickets/check-in` | Check a ticket in by QR token or ticket ID | Staff / Organizer |
| `GET` | `/api/organizer/stats` | Dashboard totals and per-event stats | Organizer |
| `POST` | `/api/organizer/events` | Create an event (capacity-driven seat map, cinema showtimes) | Organizer |
| `GET` / `PUT` / `DELETE` | `/api/organizer/events/:id` | Read for editing / update / delete one of your events | Organizer |
| `GET` | `/api/organizer/events/:id/stats` | Tier, show and check-in breakdown | Organizer |
| `POST` | `/api/organizer/events/:id/shows` | Add a showtime (cinema) | Organizer |
| `PUT` / `DELETE` | `/api/organizer/events/:id/shows/:showId` | Change or remove a showtime (blocked when tickets are sold) | Organizer |
| `GET` / `POST` | `/api/organizer/staff` | List / create staff accounts | Organizer |
| `DELETE` | `/api/organizer/staff/:id` | Remove a staff account | Organizer |
=======
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/auth/register/send-otp` | Send 6-digit OTP to email for signup | Public |
| `POST` | `/api/auth/register/verify-otp` | Verify OTP & create customer account | Public |
| `POST` | `/api/auth/login` | Login with email and password | Public |
| `POST` | `/api/auth/forgot-password` | Request password reset code | Public |
| `POST` | `/api/auth/reset-password` | Verify code and reset password | Public |
| `POST` | `/api/auth/logout` | Clear session cookie | Public |
| `GET` | `/api/auth/me` | Fetch authenticated user profile & role | Authenticated |
| `GET` | `/api/events` | List all published events (cached with micro-TTL) | Public |
| `GET` | `/api/events/:id/seats` | Get seat map, showtimes (sorted), and availability | Public |
| `POST` | `/api/events/:id/hold` | Atomically hold seats for 5 minutes (Redis + DB lock) | Customer |
| `POST` | `/api/events/:id/release` | Release held seats manually | Customer |
| `POST` | `/api/orders/confirm` | Finalize payment, generate QR tickets & dispatch email | Customer |
| `GET` | `/api/orders/my-tickets` | List user confirmed orders with QR codes & location | Customer |
| `POST` | `/api/tickets/checkin` | Turnstile QR code token or UUID check-in verification | Staff / Organizer |
| `GET` | `/api/organizer/stats` | Aggregate revenue, occupancy, and event analytics | Organizer |
| `GET` | `/api/organizer/events/:id` | Event tier breakdown and edit prefill | Organizer |
| `POST` | `/api/organizer/events` | Create new event with custom venue & showtimes | Organizer |
| `POST` | `/api/organizer/events/:id/shows` | Add a new showtime to an existing cinema event | Organizer |
| `PUT` | `/api/organizer/events/:id/shows/:showId` | Update showtime date, time, or tier pricing | Organizer |
| `DELETE` | `/api/organizer/events/:id/shows/:showId` | Remove a showtime (guarded against sold seats) | Organizer |
| `GET` | `/api/organizer/staff` | List active gate staff accounts | Organizer |
| `POST` | `/api/organizer/staff` | Provision a new gate staff member | Organizer |
| `DELETE` | `/api/organizer/staff/:id` | Revoke a gate staff account | Organizer |
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

---

## Event Editing & Dynamic Capacity

<<<<<<< HEAD
- **Ownership:** every event belongs to the organizer who created it; edits, deletes and stats check this.
- **Capacity-driven seats:** the organizer picks total seats (1-2000), optional seats per row and the VIP / Premium split; the seat map is generated from that.
- **Safe changes:** growing capacity appends seats at the back; shrinking only removes seats that are not sold or currently held. Changing the date, venue or location of an event with sold tickets requires confirmation and emails the ticket holders (times in IST).

---

## Load Testing

The hold endpoint was load-tested with 1,000 concurrent hold requests from 200 virtual users competing for 50 seats, with no duplicate holds, no duplicate tickets and no 5xx responses (about 900 requests/second, p95 66 ms). That load-test script is **not part of this repository**, so the numbers cannot be reproduced from here.
=======
- **Organizer Ownership**: Every event is strictly scoped to `Event.organizerId`. Edits and stats enforce owner authorization.
- **Capacity-Driven Seat Generation**: Total seats (1–2000), seats per row, and tier allotments generate deterministic physical seats.
- **Safe Modifications**: Capacity increases append new rows at the rear. Capacity reductions only delete unbooked seats. Date/venue shifts alert ticket holders with Indian Standard Time email updates.
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

---

## Deployment

<<<<<<< HEAD
Deploying the web app to Vercel and the API to a long-running host is covered in [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).
=======
Detailed instructions for deploying the frontend on **Vercel** and connecting it to the production API server are documented in [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
