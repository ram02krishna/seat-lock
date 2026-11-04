# Concurrency-Safe Event Ticketing with an Interactive Seat Map

A full-stack, concurrency-safe event ticketing platform built to handle flash-sale traffic spikes, interactive SVG venue seating, and venue gate check-in with zero double bookings.

Designed and built as a college capstone project showcasing transaction isolation, raw SQL atomic locking, real-time WebSocket synchronization, delayed worker queues, and high-concurrency load testing.

---

## The Problem

High-demand ticket sales (concerts, sports, festivals) suffer from a classic distributed systems challenge: **extreme contention on shared state**. 

When thousands of users click the same front-row seat at the exact same millisecond:
1. **Double-Booking**: Naive implementations read seat state, verify availability in application memory, and then write. Under concurrent traffic, multiple users read "available" simultaneously, creating double bookings.
2. **Deadlocks**: Users selecting multiple seats in different order (e.g., User A selects `[1, 2]`, User B selects `[2, 1]`) can lock rows in opposite order, crashing the database with circular deadlocks.
3. **Cart Abandonment**: If users hold seats but never complete payment, seats stay locked forever unless released by an authoritative background scheduler.
4. **Gate Turnstile Race Conditions**: Fraudsters duplicating QR codes can try to scan through two venue turnstiles at the same instant.

This project solves all four problems with database-level atomicity, deterministic lock ordering, BullMQ delayed workers, and conditional gate check-in.

---

## Architecture

```
                       +---------------------------------------+
                       |          Next.js App Router           |
                       |  - Interactive SVG Seat Map           |
                       |  - Server-Authoritative Hold Timer    |
                       |  - Real-Time Socket.IO Client         |
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
                       |  - Resend Email Service               |
                       +---------+-------------------+---------+
                                 |                   |
               Atomic $queryRaw  |                   | Delayed Jobs
               Row-Level Locks   |                   |
                                 v                   v
            +---------------------------+   +-------------------+
            |        PostgreSQL         |   |   Redis (BullMQ)  |
            |  - EventSeat (Unique idx) |   |  - 5-Min Expiry   |
            |  - Atomic UPDATE ...      |   |  - 60s Sweeper    |
            |  - Ticket QR Tokens       |   +-------------------+
            +---------------------------+
```

---

## Technical Deep Dive: The Concurrency Engine

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
```ts
if (updatedRows.length !== sortedIds.length) {
  throw new AppError(409, 'One or more selected seats are no longer available');
}
```
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

---

## Tech Stack

| Category | Technology |
|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Framer Motion, Zustand, TanStack Query, Socket.IO Client, html5-qrcode |
| **Backend** | Node.js, Express, TypeScript, Zod, JWT (httpOnly cookies), Socket.IO, BullMQ, Redis, Pino, Resend SDK, QRCode |
| **Database** | PostgreSQL 16, Prisma ORM with raw atomic `$queryRaw` transactions |
| **DevOps & CI** | Docker (multi-stage), Docker Compose, GitHub Actions (Postgres & Redis service containers) |

---

## Repository Structure

```
seat-lock/
├── apps/
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
│           │   ├── events/[id] # Event details & interactive SVG seat map
│           │   ├── checkout/   # Checkout with server-authoritative timer
│           │   ├── my-tickets/ # Attendee ticket wallet with QR codes
│           │   ├── organizer/  # Real-time analytics, revenue, capacity dashboard
│           │   ├── staff/      # Turnstile camera scanner UI (html5-qrcode)
│           │   └── login/      # Auth screen with 1-click demo logins
│           ├── components/     # SVG seat map, pan/zoom, cart, navbar
│           └── store/          # Zustand cart store
│
├── packages/
│   └── shared/                 # Zod validation schemas and shared TypeScript types
│
└── .github/workflows/          # CI pipeline with PostgreSQL and Redis containers
```

---

## Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/ram02krishna/seat-lock.git
cd seat-lock
pnpm install
```
The API generates Prisma Client during installation. If you change the Prisma schema later, regenerate it with `pnpm --filter api prisma:generate`.

### 2. Environment Variables
Copy `.env.example` to `.env` in the root and in `apps/api`:
```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

Ensure your `DATABASE_URL` and `REDIS_URL` are reachable:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/seat_lock?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="supersecretdevkey1234567890_min32chars"
```

### 3. Database Migration & Seed
Run Prisma migrations and populate the seed data (Grand Symphony Hall, 112 seats across VIP, Premium, and Standard tiers, plus 2 sample events):
```bash
pnpm db:migrate   # or: pnpm db:push
pnpm seed         # or: pnpm db:seed
```

### 4. Run Development Servers
```bash
# Starts API (port 4000) and Web (port 3000) concurrently:
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Running with Docker

### 1. Database & Cache Infrastructure Only (Recommended for Local Dev)
When running your Next.js and Express apps locally with hot-reload via `pnpm dev`:
```bash
docker compose up -d    # or: pnpm db:up
```
This spins up only `event_booking_postgres` (port 5432) and `event_booking_redis` (port 6379), completely avoiding any port 4000/3000 collisions with your local dev server.

### 2. Full Containerized Stack (Postgres, Redis, Express API, Next.js Web)
To run the entire platform inside Docker containers:
```bash
docker compose --profile app up -d --build   # or: pnpm docker:full
```
- Web: [http://localhost:3001](http://localhost:3001)
- API: [http://localhost:4000](http://localhost:4000)

*(Note: If port 4000 is occupied by a local process, you can set `DOCKER_API_PORT=4001` in your `.env`)*

To stop all containers:
```bash
docker compose down   # or: pnpm db:down
```

---

## Code Quality & Typecheck

```bash
# Run full monorepo typecheck:
pnpm typecheck

# Run production build:
pnpm build
```

---

## Role Hierarchy & Access Control

The platform enforces a real-world role and security hierarchy:

| Role | Provisioning | Default / Access | Permissions & Features |
|---|---|---|---|
| **ORGANIZER** | **Single Administrative Account** | `organizer@eventseat.com`<br>*(Password: `password123`)* | Access `/organizer` dashboard, view live revenue & occupancy analytics, create events & venues, manage ticket pricing tiers, and provision staff accounts |
| **STAFF** | **Created Exclusively by Organizer** | Provisioned via `/organizer` dashboard | Access `/staff/scanner` live camera QR code turnstile scanner, manual UUID validation, and real-time check-in |
| **CUSTOMER** | **Public Self-Registration** | Self-signup via `/login` (Register tab) | Browse events, interact with live SVG seat map, hold seats for 5 mins, checkout, view digital tickets with UUIDs, and receive QR emails |

> **Security Note:** Public registration (`POST /api/auth/register/verify-otp`) strictly assigns the `CUSTOMER` role to prevent unauthorized access to organizer and administrative consoles. Only the authenticated Organizer can provision gate Staff accounts.

### Default Testing Credentials (Local Development Only)

These demo credentials are for a local development database only. Do not use them in production; production startup requires a dedicated organizer email and a unique password of at least 16 characters. The demo seed script deletes existing records and refuses to run with `NODE_ENV=production`.

| Role | Email | Password | Primary Portal / Route |
|---|---|---|---|
| **ORGANIZER** | `organizer@eventseat.com` | `password123` | `/organizer` (Dashboard, revenue telemetry, staff manager) |
| **STAFF** | `staff@eventseat.com` | `password123` | `/staff/scanner` (Gate camera QR scanner & turnstile check-in) |
| **CUSTOMER** | `customer@eventseat.com` | `password123` | `/` & `/my-tickets` (Browse, hold seats, checkout, QR tickets) |

---

## Key API Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/auth/register/send-otp` | Send 6-digit OTP to email for signup | Public |
| `POST` | `/api/auth/register/verify-otp` | Verify OTP & create customer account | Public |
| `POST` | `/api/auth/login` | Login with email and password | Public |
| `POST` | `/api/auth/logout` | Clear session cookie | Public |
| `GET` | `/api/auth/me` | Fetch authenticated user profile & role | Authenticated |
| `GET` | `/api/events` | List all published events | Public |
| `GET` | `/api/events/:id/seats` | Get seat map layout and real-time availability | Public |
| `POST` | `/api/events/:id/hold` | Atomically hold seats for 5 minutes (Redis + DB lock) | Customer |
| `POST` | `/api/events/:id/release` | Release held seats manually | Customer |
| `POST` | `/api/orders/confirm` | Finalize payment, generate QR tickets & dispatch email | Customer |
| `GET` | `/api/orders/my-tickets` | List user confirmed orders with QR codes & UUIDs | Customer |
| `POST` | `/api/tickets/checkin` | Turnstile QR code token or UUID check-in verification | Staff / Organizer |
| `GET` | `/api/organizer/stats` | Aggregate revenue, occupancy, and event analytics | Organizer |
| `GET` | `/api/organizer/events/:id/stats` | Event tier breakdown and gate check-in telemetry | Organizer |
| `POST` | `/api/organizer/events` | Create new event with custom venue and tier pricing | Organizer |
| `GET` | `/api/organizer/staff` | List active gate staff accounts | Organizer |
| `POST` | `/api/organizer/staff` | Provision a new gate staff member (`email`, `password`) | Organizer |
| `DELETE` | `/api/organizer/staff/:id` | Revoke a gate staff account | Organizer |

---

## Database Management & Clean Scripts

```bash
# Wipe test accounts, orders, tickets, and reset all seats to 100% AVAILABLE:
pnpm --filter api run db:clean

# Re-seed baseline venue, seats, and sample events:
pnpm --filter api run prisma:seed
```

---

## Deployment

Detailed instructions for deploying the frontend on **Vercel** and connecting it to the production API server are documented in [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).


## Event editing & dynamic seat capacity

**Ownership.** Every event records the organizer who created it (`Event.organizerId`). Only that organizer can edit it
(`GET/PUT /api/organizer/events/:id`); other organizers get `403`, customers get `403`/`401`. The check runs on the backend,
inside the same transaction as the update. Dashboard stats are also scoped to the signed-in organizer's own events.
Events that existed before this change are assigned to the earliest organizer account by the migration (and, for any
orphaned events, again at server start).

**Capacity drives the seat map.** There is no fixed seat count. When creating an event the organizer sets `totalSeats`
(1–2000), and optionally `seatsPerRow`, `vipSeats` and `premiumSeats` (the rest are Standard). The API generates the seats
(unique `section/row/number`, x/y coordinates) and a layout for the chosen venue style, and every event gets its own venue
record, so capacities never affect one another. `Event.capacity` always equals the number of `EventSeat` rows; this is
verified at the end of every edit transaction.

**What an edit may change** (`PUT /api/organizer/events/:id`, all fields optional): title, description, date/time, venue name,
location, image URL, per-tier prices and total seats.

| Change | Rule |
| --- | --- |
| Capacity up | New seats are added to the rear tier (filling the last row first, then new rows). Existing seats are never moved or renumbered. |
| Capacity down | Only open seats are removed, from the back. Sold seats and seats with a live hold are never removed; the API answers `409 CAPACITY_BELOW_BOOKED` with `minCapacity`. Deletion is guarded in SQL, so a seat grabbed a moment earlier aborts the whole edit. |
| Prices | Applied to open seats only. Sold seats and seats currently held keep their price, so tickets and carts never change retroactively. The response reports how many seats kept the old price; saving again after holds expire applies it to the rest. |
| Date, venue, location | If tickets are already sold the API returns `409 CONFIRMATION_REQUIRED` until the request carries `confirm: true`; ticket holders are then emailed. |
| Concurrent edits | `expectedUpdatedAt` is checked; a stale form gets `409 STALE_EVENT`. Edits are serialized with a row lock on the event. |
| Started / cancelled events | Cannot be edited (`409`). |

Seat availability is still decided by the existing atomic hold/confirm queries (unique `EventSeat(eventId, seatId)` and
`Ticket.eventSeatId`), so a seat can't be double-booked. After an edit the API clears the events cache and emits an
`event:updated` socket message so open seat maps and listings reload.

Run `pnpm --filter api check:layout` for the seat-layout sanity checks. Apply the new migration with
`pnpm --filter api exec prisma migrate deploy` (or `pnpm db:migrate` in development).
