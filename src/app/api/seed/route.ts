import { NextResponse } from 'next/server';
import { seedDatabase } from '@/lib/seed/seed';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/seed — idempotent; clears and re-seeds the sample org.
export async function POST() {
  try {
    const result = await seedDatabase();
    return NextResponse.json(result);
  } catch (err) {
    console.error('Seed failed:', err);
    return NextResponse.json(
      { ok: false, message: 'Seed failed', error: String(err) },
      { status: 500 },
    );
  }
}

// GET /api/seed — returns whether the DB is currently seeded
export async function GET() {
  const orgCount = await db.organization.count();
  const eventCount = await db.event.count();
  return NextResponse.json({
    seeded: orgCount > 0,
    orgCount,
    eventCount,
  });
}
