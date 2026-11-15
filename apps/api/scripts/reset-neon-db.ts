import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function main() {
  console.log('--- Database Reset ---');
  console.log('Target URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@') : 'not found');

  const currentUserRes = await prisma.$queryRawUnsafe<Array<{ current_user: string }>>(`SELECT current_user;`);
  const currentUser = currentUserRes[0]?.current_user;

  console.log('Dropping and recreating public schema...');
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA public;`);
  if (currentUser) {
    await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO "${currentUser}";`);
  }
  await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO public;`);
  await prisma.$executeRawUnsafe(`COMMENT ON SCHEMA public IS 'standard public schema';`);

  console.log('Public schema reset successfully.');
}

main()
  .catch((err) => {
    console.error('Reset failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
