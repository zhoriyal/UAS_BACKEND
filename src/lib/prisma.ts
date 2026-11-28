import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

function getDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw || !process.env.VERCEL || !raw.startsWith('mysql://')) return raw;
  try {
    const parsed = new URL(raw);
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '2');
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '15');
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

const datasourceUrl = getDatasourceUrl();
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
