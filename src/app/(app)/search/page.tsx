// Vuno — /search?q=…
//
// The search runs on the server for the first paint, so a link somebody sent
// shows its results before any JavaScript has loaded and works with none. The
// field then takes over and keeps the URL in step.

import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { currentViewer } from '@/lib/auth';
import { search } from '@/lib/search';
import { SearchView } from '@/components/vuno/search-view';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) notFound();
  const viewer = await currentViewer();
  if (!viewer) notFound();

  return <SearchView initial={await search(org.id, viewer, q ?? '')} />;
}
