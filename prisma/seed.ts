import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = 'admin@museum.com';
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!password) {
    throw new Error('ADMIN_INITIAL_PASSWORD wajib diatur di .env sebelum menjalankan seeder');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.admin.upsert({
    where: { username },
    update: {
      passwordHash,
      nama: 'Administrator',
      role: 'SUPERADMIN',
    },
    create: {
      username,
      passwordHash,
      nama: 'Administrator',
      role: 'SUPERADMIN',
    },
  });

  console.log(`Akun admin ${username} berhasil disiapkan.`);
}

main()
  .catch((e) => {
    console.error('Error saat seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });