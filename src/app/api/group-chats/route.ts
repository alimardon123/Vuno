// Vuno — POST /api/group-chats
// Create an ad-hoc multi-person GROUP CHAT (not a team channel, not a DM).
// Per the user's direction: group chats are CHATS, not channels.
// The storage uses the Channel table (kind='group') but the API + UI always
// refer to these as "group chats" — never "channels".
//
// Flow:
//   1. Receive { name, memberIds } — the chat name + member agent/user IDs
//   2. Create a chat with a deterministic ID: group-{slug}-{timestamp}
//   3. Return the chat as a "chat" object

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  memberIds: z.array(z.string()).min(1).max(50),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = (await req.json()) as unknown;
    parsed = bodySchema.parse(json);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Invalid body' },
      { status: 400 },
    );
  }

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, tenantId: true },
  });
  if (!org) {
    return NextResponse.json({ ok: false, error: 'No organization found' }, { status: 400 });
  }

  // Create a deterministic-ish ID: group + slugified name + short timestamp
  const slug = parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
  const chatId = `chat-group-${slug}-${Date.now().toString(36).slice(-6)}`;

  // Only members of this org can be added — an unchecked id would otherwise
  // create a participant row pointing outside the org.
  const members = await db.member.findMany({
    where: { orgId: org.id, id: { in: parsed.memberIds } },
    select: { id: true },
  });
  if (members.length !== parsed.memberIds.length) {
    const known = new Set(members.map((m) => m.id));
    const unknown = parsed.memberIds.filter((id) => !known.has(id));
    return NextResponse.json(
      { ok: false, error: `Not members of this org: ${unknown.join(', ')}` },
      { status: 400 },
    );
  }

  // Create the group chat (not a DM, not tied to a team)
  const chat = await db.channel.create({
    data: {
      id: chatId,
      tenantId: org.tenantId,
      orgId: org.id,
      teamId: null,
      kind: 'group',
      name: parsed.name,
      slug: `group-${slug}`,
      topic: `Group chat: ${parsed.name}`,
      members: {
        create: members.map((m) => ({
          tenantId: org.tenantId,
          orgId: org.id,
          memberId: m.id,
        })),
      },
    },
  });

  // Return as "chat" — the UI never refers to these as channels
  return NextResponse.json({ ok: true, chat: { ...chat, isChat: true, isGroupChat: true } });
}

// GET — list all group chats
export async function GET() {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!org) return NextResponse.json({ chats: [] });

  const groupChats = await db.channel.findMany({
    where: { orgId: org.id, kind: 'group' },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({
    chats: groupChats.map((c) => ({ ...c, isChat: true, isGroupChat: true })),
  });
}
