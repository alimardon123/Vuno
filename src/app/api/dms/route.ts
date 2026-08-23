// Vuno — POST /api/dms
// Get-or-create a DM chat between the current user (Kai) and another member
// (agent or human). Per the user's direction: DMs are CHATS, not channels.
// The storage uses the Channel table (kind='dm') but the API + UI always
// refer to these as "chats" — never "channels".
//
// Flow:
//   1. Receive { withMemberId } — the agent or user to chat with
//   2. Compute a deterministic chat slug: dm-{a}-{b} (sorted)
//   3. Find or create the chat (kind='dm', teamId=null)
//   4. Return the chat as a "chat" object (not "channel")

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getMember, getOrgOwner } from '@/lib/members';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  withMemberId: z.string().min(1),
  withMemberKind: z.enum(['agent', 'human']).default('agent'),
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

  // The org owner. Humans and agents resolve through the same helper, so there
  // is no branch on kind here any more (ADR-0009).
  const owner = await getOrgOwner(org.id);
  if (!owner) {
    return NextResponse.json({ ok: false, error: 'No org owner found' }, { status: 400 });
  }

  const target = await getMember(parsed.withMemberId);
  if (!target) {
    return NextResponse.json({ ok: false, error: 'Unknown member' }, { status: 400 });
  }
  const targetName = target.displayName;

  // Deterministic slug: sort the two IDs so dm-a-b == dm-b-a
  const ids = [owner.id, parsed.withMemberId].sort();
  const slug = `dm-${ids[0]}-${ids[1]}`;
  const chatId = `chat-${slug}`;

  // Find or create the DM chat (stored in Channel table with kind='dm')
  const existing = await db.channel.findUnique({ where: { id: chatId } });
  if (existing) {
    // Return as "chat" — never expose "channel" naming to the client
    return NextResponse.json({ ok: true, chat: { ...existing, isChat: true } });
  }

  // Create a new DM chat (kind='dm', no team). Both participants are recorded,
  // because a DM titles itself from whoever is reading it.
  const chat = await db.channel.create({
    data: {
      id: chatId,
      tenantId: org.tenantId,
      orgId: org.id,
      teamId: null,
      kind: 'dm',
      name: targetName,
      slug,
      topic: `Direct message with ${targetName}`,
      members: {
        create: [owner.id, target.id].map((memberId) => ({
          tenantId: org.tenantId,
          orgId: org.id,
          memberId,
        })),
      },
    },
  });

  // Return as "chat" — the UI never refers to these as channels
  return NextResponse.json({ ok: true, chat: { ...chat, isChat: true } });
}
