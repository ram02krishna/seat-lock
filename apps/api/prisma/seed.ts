import path from 'path';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { PrismaClient, Role, EventStatus, SeatStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getVenueTemplate } from '../src/services/venueTemplates.service';
import { buildSeatPlan } from '../src/services/seatLayout.service';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the destructive demo seed in production.');
  }

  console.log('Seeding database with multi-architecture seatmaps...');

  // 1. Clean existing records
  await prisma.ticket.deleteMany();
  await prisma.order.deleteMany();
  await prisma.eventSeat.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.event.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.user.deleteMany();

  // 2. Create users
  const passwordHash = await bcrypt.hash('password123', 10);

  const organizer = await prisma.user.create({
    data: {
      email: 'organizer@eventseat.com',
      passwordHash,
      role: Role.ORGANIZER,
    },
  });

  const staff = await prisma.user.create({
    data: {
      email: 'staff@eventseat.com',
      passwordHash,
      role: Role.STAFF,
    },
  });

  const customer = await prisma.user.create({
    data: {
      email: 'customer@eventseat.com',
      passwordHash,
      role: Role.CUSTOMER,
    },
  });

  console.log('Created users: organizer, staff, customer');

  // Helper to create a venue + event. Capacity is chosen per event; the seat map is generated from it.
  async function createVenueWithEvent(
    type: 'THEATER_DOLBY' | 'CONFERENCE_HALL' | 'AUDITORIUM' | 'ARENA',
    totalSeats: number,
    eventTitle: string,
    eventDesc: string,
    daysAhead: number,
    hours: number,
    minutes: number
  ) {
    const template = getVenueTemplate(type);
    const plan = buildSeatPlan({ venueType: type, totalSeats });

    const venue = await prisma.venue.create({
      data: {
        name: template.defaultName,
        layout: plan.layout as any,
      },
    });

    await prisma.seat.createMany({ data: plan.seats.map((s) => ({ ...s, venueId: venue.id })) });
    const createdSeats = await prisma.seat.findMany({ where: { venueId: venue.id } });

    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + daysAhead);
    startsAt.setHours(hours, minutes, 0, 0);

    const event = await prisma.event.create({
      data: {
        venueId: venue.id,
        organizerId: organizer.id,
        title: eventTitle,
        description: eventDesc,
        startsAt,
        capacity: createdSeats.length,
        status: EventStatus.PUBLISHED,
      },
    });

    const eventSeatsData = createdSeats.map((seat) => ({
      eventId: event.id,
      seatId: seat.id,
      price: template.recommendedPricing[seat.tier as 'VIP' | 'PREMIUM' | 'STANDARD'] || 50000,
      status: SeatStatus.AVAILABLE,
    }));

    await prisma.eventSeat.createMany({ data: eventSeatsData });
    console.log(`Created [${type}] venue "${venue.name}" with event "${event.title}" (${createdSeats.length} seats)`);
  }

  // 1. Dolby Atmos Theater
  await createVenueWithEvent(
    'THEATER_DOLBY',
    60,
    'Midnight Screening: The Last Monsoon',
    'A late-night screening of the award-winning drama in Dolby Atmos, with recliner seating up front.',
    7,
    19,
    45
  );

  // 2. Corporate Conference Hall
  await createVenueWithEvent(
    'CONFERENCE_HALL',
    150,
    'Distributed Systems India Summit 2026',
    'A full day of talks on scaling databases, queues and real-time systems, with lunch and a hallway track.',
    14,
    9,
    30
  );

  // 3. Grand Auditorium
  await createVenueWithEvent(
    'AUDITORIUM',
    240,
    'City Philharmonic: An Evening of Rachmaninoff',
    'The City Philharmonic performs the Second Piano Concerto and Symphonic Dances. One interval.',
    21,
    18,
    30
  );

  // 4. Live Concert Arena
  await createVenueWithEvent(
    'ARENA',
    400,
    'Indie Fest Live: Headline Night',
    'Four bands, one stage and a runway through the front pit. Doors open two hours before the headliner.',
    28,
    20,
    0
  );

  console.log('Seeding complete! 4 venue architectures successfully populated.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
