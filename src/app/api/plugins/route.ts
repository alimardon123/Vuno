// Vuno — /api/plugins
//
// Installing a plugin creates members, skills and connectors, so it is an
// action the viewer takes rather than a setting a page saves. Everything here
// goes through the same viewer the rest of the app uses.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { catalogueEntry } from '@/lib/plugins/catalogue';
import { installPlugin, listPlugins, PluginError, uninstallPlugin } from '@/lib/plugins';

export const dynamic = 'force-dynamic';

// One org per install today. The viewer is checked for a real session; the org
// is resolved the same way every other route here resolves it.
async function currentOrg() {
  return db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true } });
}

function fail(e: unknown) {
  if (e instanceof PluginError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }
  throw e;
}

export async function GET(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const org = await currentOrg();
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });
  return NextResponse.json({ plugins: await listPlugins(org.id) });
}

const installBody = z.union([
  z.object({ catalogueKey: z.string().min(1).max(60) }),
  // A manifest supplied here. Bounded, because this is a JSON body somebody
  // pastes and an unbounded one is a way to fill the disk.
  z.object({ manifest: z.unknown() }),
]);

export async function POST(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const org = await currentOrg();
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });

  try {
    const parsed = installBody.parse((await req.json()) as unknown);

    if ('catalogueKey' in parsed) {
      const manifest = await catalogueEntry(parsed.catalogueKey);
      if (!manifest) {
        throw new PluginError(`There is no plugin called "${parsed.catalogueKey}" in the catalogue.`, 404);
      }
      const result = await installPlugin({
        tenantId: org.tenantId,
        orgId: org.id,
        manifest,
        source: 'catalogue',
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const result = await installPlugin({
      tenantId: org.tenantId,
      orgId: org.id,
      manifest: parsed.manifest,
      source: 'added',
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return fail(e);
  }
}

const removeBody = z.object({ pluginId: z.string().min(1) });

export async function DELETE(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const org = await currentOrg();
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });

  try {
    const { pluginId } = removeBody.parse((await req.json()) as unknown);
    const { name, agents } = await uninstallPlugin(org.id, pluginId);
    return NextResponse.json({ ok: true, name, agents });
  } catch (e) {
    return fail(e);
  }
}
