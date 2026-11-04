-- AlterTable: ownership, capacity and extra event details
ALTER TABLE "Event"
  ADD COLUMN "organizerId" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 0;

-- Backfill capacity from the seats each existing event already has
UPDATE "Event" e
SET "capacity" = (SELECT COUNT(*) FROM "EventSeat" es WHERE es."eventId" = e."id");

-- Backfill ownership: existing events belong to the earliest organizer account
UPDATE "Event"
SET "organizerId" = (SELECT "id" FROM "User" WHERE "role" = 'ORGANIZER' ORDER BY "createdAt" ASC LIMIT 1)
WHERE "organizerId" IS NULL;

-- CreateIndex
CREATE INDEX "Event_organizerId_idx" ON "Event"("organizerId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizerId_fkey"
  FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
