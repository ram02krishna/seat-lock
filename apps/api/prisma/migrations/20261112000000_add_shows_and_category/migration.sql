-- The init migration predates cinema show timings and event categories. This brings a database
-- built from migrations in line with schema.prisma (what `prisma db push` already produced).

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "category" TEXT;

-- AlterTable
ALTER TABLE "EventSeat" ADD COLUMN "showId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "showId" TEXT;

-- CreateTable
CREATE TABLE "Show" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "pricing" JSONB,
    "totalSeats" INTEGER NOT NULL DEFAULT 0,
    "status" "EventStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Show_pkey" PRIMARY KEY ("id")
);

-- A cinema stores one EventSeat per physical seat per show, so (eventId, seatId) can no longer be unique.
DROP INDEX "EventSeat_eventId_seatId_key";

-- CreateIndex
CREATE INDEX "Show_eventId_startsAt_idx" ON "Show"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "EventSeat_eventId_seatId_idx" ON "EventSeat"("eventId", "seatId");

-- CreateIndex
CREATE INDEX "EventSeat_showId_seatId_idx" ON "EventSeat"("showId", "seatId");

-- CreateIndex
CREATE INDEX "EventSeat_showId_status_idx" ON "EventSeat"("showId", "status");

-- CreateIndex
CREATE INDEX "EventSeat_showId_heldByUserId_idx" ON "EventSeat"("showId", "heldByUserId");

-- CreateIndex
CREATE INDEX "Order_showId_idx" ON "Order"("showId");

-- AddForeignKey
ALTER TABLE "Show" ADD CONSTRAINT "Show_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeat" ADD CONSTRAINT "EventSeat_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE SET NULL ON UPDATE CASCADE;
