# Concurrency-Safe Event Ticketing with an Interactive Seat Map

A full-stack, concurrency-safe event ticketing platform built to handle flash-sale traffic spikes, interactive SVG venue seating, multi-showtime cinema scheduling, and venue gate turnstile check-in with zero double bookings.

Designed and built as a high-performance system showcasing atomic raw-SQL seat holds, real-time WebSocket synchronization, delayed worker queues and cinema multi-showtime management.

---

## The Problem

High-demand ticket sales (concerts, sports, festivals, movie premieres) suffer from a classic distributed systems challenge: **extreme contention on shared state**. 

When thousands of users click the same seat at the exact same millisecond:
1. **Double-Booking**: Naive implementations read seat state, verify availability in application memory, and then write. Under concurrent traffic, multiple users read "available" simultaneously, creating double bookings.
2. **Deadlocks**: Users selecting multiple seats in a different order (e.g., User A selects `[1, 2]`, User B selects `[2, 1]`) can lock rows in opposite order and deadlock the database.
3. **Cart Abandonment**: If users hold seats but never complete payment, seats stay locked forever unless released by an authoritative background scheduler.
4. **Gate Turnstile Race Conditions**: Fraudsters duplicating QR codes can try to scan through two venue turnstiles at the same instant.
5. **Multi-Showtime Schedule Inconsistencies**: Movie theaters running multiple shows per day require isolated seat inventories per showtime while preserving chronological date and time sorting from morning to night.

This project solves these problems with database-level atomicity, deterministic seat ordering, BullMQ delayed workers, conditional gate check-in, and per-show seat inventories.

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
```ts
if (updatedRows.length !== sortedIds.length) {
  throw new AppError(409, 'One or more selected seats are no longer available');
}
```

### 4. Hold expiry: BullMQ + a database sweeper
- After a hold, a delayed BullMQ job (5 minutes) is queued. If the seats are still held and expired when it runs, they go back to `AVAILABLE` and a `seats:released` Socket.IO event updates every open seat map.
- A 60-second periodic job runs the same conditional release for any expired hold the worker missed (for example after a restart).
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

---

## Tech Stack

| Category | Technology |
|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Framer Motion, Zustand, TanStack Query, Socket.IO Client, html5-qrcode |
| **Backend** | Node.js 20, Express, TypeScript, Zod, JWT (httpOnly cookies), Socket.IO, BullMQ, Redis, Pino, Resend, QRCode |
| **Database** | PostgreSQL 16, Prisma ORM with raw atomic `$queryRaw` statements |
| **Tooling** | pnpm workspaces, Docker (multi-stage) + Docker Compose, GitHub Actions |

---

## Repository Structure

```
seat-lock/
├── apps/
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
```

---

## Getting Started

**Prerequisites:** Node.js 20+, [pnpm 10](https://pnpm.io/installation) (`corepack enable` picks up the exact version from `package.json`), and either PostgreSQL 14+ **or** Docker.

Pick one of the three setups. All of them end with the app at **http://localhost:3000** (or **:3001** for the full Docker stack).

### Option 1 - Local or Cloud Services

You need a PostgreSQL database and a Redis instance (e.g. running via Docker, or cloud providers such as Neon PostgreSQL and Upstash Redis).

```bash
git clone https://github.com/ram02krishna/seat-lock.git
cd seat-lock
pnpm install                 # also generates the Prisma client
cp .env.example .env
```

Edit `.env` and set:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/seat_lock?schema=public   # or Neon connection string
REDIS_URL=redis://localhost:6379                                                     # or Upstash rediss:// string
```

Create the database, create the tables, load the demo data and start everything:
```bash
createdb seat_lock           # or: psql -U postgres -c 'CREATE DATABASE seat_lock;'
pnpm db:deploy               # apply the migrations
pnpm db:seed                 # demo events and users (erases existing data!)
pnpm dev                     # API on :4000 and web on :3000
```
To run only one side: `pnpm dev:api` or `pnpm dev:web`.

### Option 2 - Docker for PostgreSQL and Redis, apps on your machine

```bash
git clone https://github.com/ram02krishna/seat-lock.git
cd seat-lock
pnpm install
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
| `REDIS_URL` | API | Redis URL (`redis://localhost:6379` for local Docker or `rediss://...` for Upstash) |
| `JWT_SECRET` | API | Session signing key; must be unique and 32+ characters in production |
| `CLIENT_URL` | API | Comma-separated exact frontend origins allowed by CORS |
| `ORGANIZER_EMAIL`, `ORGANIZER_PASSWORD` | API | Organizer account created on first start |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | API | Email delivery (required in production) |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL` | Web | Where the browser finds the API (default `http://localhost:4000`; set in `apps/web/.env`) |

---

## Role Hierarchy & Access Control

| Role | How it is created | Can do |
|---|---|---|
| **ORGANIZER** | The single account created at API start-up (or by the seed) | Use the `/organizer` dashboard: create, edit and delete their own events, manage cinema showtimes and tier prices, see revenue and occupancy, create and remove staff accounts |
| **STAFF** | Created by the organizer in the dashboard | Use `/staff/scanner` (camera QR scanner or manual code entry) to check tickets in |
| **CUSTOMER** | Self-registration on `/login` | Browse events, pick showtimes and seats, hold seats for 5 minutes, check out, view and print tickets |

---

## Key API Endpoints

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

---

## Event Editing & Dynamic Capacity

- **Ownership:** every event belongs to the organizer who created it; edits, deletes and stats check this.
- **Capacity-driven seats:** the organizer picks total seats (1-2000), optional seats per row and the VIP / Premium split; the seat map is generated from that.
- **Safe changes:** growing capacity appends seats at the back; shrinking only removes seats that are not sold or currently held. Changing the date, venue or location of an event with sold tickets requires confirmation and emails the ticket holders (times in IST).

---

## Load Testing

The hold endpoint was load-tested with 1,000 concurrent hold requests from 200 virtual users competing for 50 seats, with no duplicate holds, no duplicate tickets and no 5xx responses (about 900 requests/second, p95 66 ms). That load-test script is **not part of this repository**, so the numbers cannot be reproduced from here.

---

## Deployment

Deploying the web app to Vercel and the API to a long-running host is covered in [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).
