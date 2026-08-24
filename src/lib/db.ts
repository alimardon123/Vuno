import { PrismaClient } from '@prisma/client'

// A relative SQLite path in DATABASE_URL is resolved against whatever directory
// the process runs from, and the entry points do not share one: `next dev` runs
// from the project root, the standalone production server from
// `.next/standalone`. `.env` ships `file:../db/dev.db` because that is what the
// Prisma CLI wants (relative to prisma/schema.prisma), and the production build
// served 500 on every page reading that same string from somewhere else.
//
// The launcher knows where the project is; the bundled runtime does not, and
// walking up to a package.json finds the one Next writes into the build output.
// So `scripts/start.ts` makes the path absolute before starting the server, and
// the deployment scripts already pass an absolute one.

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
