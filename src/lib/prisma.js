/**
 * Prisma Client helper instance
 * Dapat digunakan di controller & middleware saat menggunakan Prisma
 */
let prisma;

try {
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
} catch (_) {
  // Prisma Client belum di-generate secara lokal
  prisma = null;
}

module.exports = prisma;

