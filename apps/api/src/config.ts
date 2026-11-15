import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load the repository-root .env no matter where the process is started from (dotenv never
// overrides variables that are already set, so real environment variables always win).
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().default('supersecretdevkey1234567890_min32chars'),
  ORGANIZER_EMAIL: z.string().email().default('organizer@eventseat.com'),
  ORGANIZER_PASSWORD: z.string().default('password123'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_TICKETS_FROM_EMAIL: z.string().optional(),
  RESEND_OVERRIDE_EMAIL: z.string().optional(),
  CLIENT_TICKETS_URL: z.string().optional(),
  QR_CODE_API_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production') {
  const problems: string[] = [];
  const jwtSecret = process.env.JWT_SECRET || '';
  if (
    jwtSecret.length < 32 ||
    jwtSecret === 'supersecretdevkey1234567890_min32chars' ||
    jwtSecret.toLowerCase().startsWith('replace-with-')
  ) {
    problems.push('JWT_SECRET must be set to a unique random string of at least 32 characters');
  }
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL must be set');
  const clientOrigins = (process.env.CLIENT_URL || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!clientOrigins.length || clientOrigins.some((origin) => origin === '*' || !/^https:\/\/[^/]+$/.test(origin))) {
    problems.push('CLIENT_URL must list exact trusted HTTPS frontend origins (no wildcards or paths)');
  }
  if (!process.env.REDIS_URL) problems.push('REDIS_URL must be set');
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.toLowerCase().startsWith('re_your_')) {
    problems.push('RESEND_API_KEY must be set because registration and password reset require email delivery');
  }
  if (!process.env.RESEND_FROM_EMAIL?.trim()) {
    problems.push('RESEND_FROM_EMAIL must be set to a sender address verified with Resend');
  }
  if (!process.env.ORGANIZER_EMAIL?.trim()) {
    problems.push('ORGANIZER_EMAIL must be set to your production organizer account email');
  }
  const organizerPassword = process.env.ORGANIZER_PASSWORD || '';
  if (organizerPassword.length < 8 || organizerPassword.toLowerCase().startsWith('replace-with-')) {
    problems.push('ORGANIZER_PASSWORD must be set to a unique password of at least 8 characters');
  }
  if (problems.length > 0) {
    console.error(`Refusing to start in production:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
}

export const config = parsed.data;
