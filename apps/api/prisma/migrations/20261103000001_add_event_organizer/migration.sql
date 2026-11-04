-- AlterTable: add organizerId and totalSeats to Event
ALTER TABLE "Event" ADD COLUMN "organizerId" TEXT;
ALTER TABLE "Event" ADD COLUMN "totalSeats" INTEGER;

-- CreateIndex
CREATE INDEX "Event_organizerId_idx" ON "Event"("organizerId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
