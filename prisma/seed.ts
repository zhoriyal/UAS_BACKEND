import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Memulai proses seeding data...');

  // Hapus data lama jika ada (opsional untuk reset)
  await prisma.admin.deleteMany();

  // Buat akun admin default
  const hashedPassword = await bcrypt.hash('admin123', 10);
  await prisma.admin.create({
    data: {
      username: 'admin',
      passwordHash: hashedPassword,
      nama: 'Administrator',
      role: 'ADMIN',
    },
  });

  console.log('Seeding data berhasil ditambahkan!');
}

main()
  .catch((e) => {
    console.error('Error saat seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });