import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  walConfigured: boolean | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // 'query' logs every read and write to stdout. Under a polling orchestrator
    // that is continuous write amplification on the hot path, and in production
    // it puts message bodies into the log.
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// SQLite defaults leave readers blocking the writer and fail instantly on a
// held lock. WAL fixes the first; busy_timeout makes concurrent writers queue
// instead of erroring (ADR-0008).
if (!globalForPrisma.walConfigured) {
  globalForPrisma.walConfigured = true
  // Both PRAGMAs return their resulting value as a row, so both are queries.
  // $executeRawUnsafe rejects them with "Execute returned results".
  void db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
    .then(() => db.$queryRawUnsafe('PRAGMA busy_timeout = 5000'))
    .catch((err: unknown) => {
      console.error('[db] failed to configure SQLite pragmas:', err)
    })
}
