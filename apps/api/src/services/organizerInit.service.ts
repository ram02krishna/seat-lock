import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { Role } from '@prisma/client';

export async function ensureDefaultOrganizer() {
  try {
    const existingOrganizer = await prisma.user.findFirst({
      where: { role: Role.ORGANIZER },
    });

    if (existingOrganizer) {
      logger.info(`Organizer account verified: ${existingOrganizer.email}`);
      await assignOrphanEvents(existingOrganizer.id);
      return;
    }

    // Check if the default email exists
    const email = config.ORGANIZER_EMAIL.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { role: Role.ORGANIZER },
      });
      logger.info(`Promoted existing user ${email} to Organizer`);
      await assignOrphanEvents(existingUser.id);
      return;
    }

    // Create the sole default organizer account
    const passwordHash = await bcrypt.hash(config.ORGANIZER_PASSWORD, 10);
    const organizer = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: Role.ORGANIZER,
      },
    });

    logger.info(`Created default single Organizer account: ${organizer.email}`);
    await assignOrphanEvents(organizer.id);
  } catch (err: any) {
    logger.error(err, 'Failed to ensure default organizer account');
  }
}

/** Events created before ownership existed (or whose organizer was deleted) go to a live organizer. */
async function assignOrphanEvents(organizerId: string) {
  const { count } = await prisma.event.updateMany({
    where: { organizerId: null },
    data: { organizerId },
  });
  if (count > 0) logger.info(`Assigned ${count} ownerless event(s) to organizer ${organizerId}`);
}
