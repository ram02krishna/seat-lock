# Concurrency-Safe Event Ticketing with an Interactive Seat Map

A production-ready, full-stack, concurrency-safe event ticketing platform built to handle flash-sale traffic spikes, interactive SVG venue seating, multi-showtime cinema scheduling, and venue gate turnstile check-in with zero double bookings.

Designed and built as a high-performance system showcasing transaction isolation, raw SQL atomic locking, real-time WebSocket synchronization, delayed worker queues, cinema multi-showtime management, and high-concurrency load testing.

---

## The Problem

High-demand ticket sales (concerts, sports, festivals, movie premieres) suffer from a classic distributed systems challenge: **extreme contention on shared state**. 

When thousands of users click the same seat at the exact same millisecond:
1. **Double-Booking**: Naive implementations read seat state, verify availability in application memory, and then write. Under concurrent traffic, multiple users read "available" simultaneously, creating double bookings.
2. **Deadlocks**: Users selecting multiple seats in different order (e.g., User A selects `[1, 2]`, User B selects `[2, 1]`) can lock rows in opposite order, crashing the database with circular deadlocks.
3. **Cart Abandonment**: If users hold seats but never complete payment, seats stay locked forever unless released by an authoritative background scheduler.
4. **Gate Turnstile Race Conditions**: Fraudsters duplicating QR codes can try to scan through two venue turnstiles at the same instant.
5. **Multi-Showtime Schedule Inconsistencies**: Movie theaters running multiple shows per day require isolated seat inventories per showtime while preserving chronological date and time sorting from morning to night.

This project solves these problems with database-level atomicity, deterministic lock ordering, BullMQ delayed workers, conditional gate check-in, and chronological multi-show management.

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
Run Prisma migrations and populate the seed data (Grand Symphony Hall, 112 seats across VIP, Premium, and Standard tiers, plus sample events):
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

---

## Role Hierarchy & Access Control

| Role | Provisioning | Default / Access | Permissions & Features |
|---|---|---|---|
| **ORGANIZER** | **Single Administrative Account** | `organizer@eventseat.com`<br>*(Password: `password123`)* | Access `/organizer` dashboard, view live revenue & occupancy analytics, create events & venues, schedule multiple showtimes, manage ticket pricing tiers, and provision staff accounts |
| **STAFF** | **Created Exclusively by Organizer** | Provisioned via `/organizer` dashboard | Access `/staff/scanner` live camera QR code turnstile scanner, manual UUID validation, and real-time check-in |
| **CUSTOMER** | **Public Self-Registration** | Self-signup via `/login` (Register tab) | Browse events, select cinema dates & showtimes, interact with live SVG seat map, hold seats for 5 mins, checkout, view/print digital tickets with QR passes |

---

## Key API Endpoints

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

---

## Event Editing & Dynamic Capacity

- **Organizer Ownership**: Every event is strictly scoped to `Event.organizerId`. Edits and stats enforce owner authorization.
- **Capacity-Driven Seat Generation**: Total seats (1–2000), seats per row, and tier allotments generate deterministic physical seats.
- **Safe Modifications**: Capacity increases append new rows at the rear. Capacity reductions only delete unbooked seats. Date/venue shifts alert ticket holders with Indian Standard Time email updates.

---

## Deployment

Detailed instructions for deploying the frontend on **Vercel** and connecting it to the production API server are documented in [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).
