import { PrismaClient } from '@prisma/client';
import { config } from './config';

export const prisma = new PrismaClient({
  datasources: config.DATABASE_URL
    ? {
        db: {
          url: config.DATABASE_URL,
        },
      }
    : undefined,
});
