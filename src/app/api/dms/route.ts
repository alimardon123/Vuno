// Vuno — POST /api/dms
// Get-or-create a DM chat between the current user (Kai) and another member
// (agent or human). Per the user's direction: DMs are CHATS, not channels.
// The storage uses the Channel table (isDm=true) but the API + UI always
// refer to these as "chats" — never "channels".
//
// Flow:
//   1. Receive { withMemberId } — the agent or user to chat with
//   2. Compute a deterministic chat slug: dm-{a}-{b} (sorted)
//   3. Find or create the chat (isDm=true, teamId=null)
//   4. Return the chat as a "chat" object (not "channel")

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';

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

  // Resolve the current user (org owner = Kai in v1)
  const owner = await db.user.findFirst({
    where: { tenantId: org.tenantId, isOrgOwner: true },
    select: { id: true, name: true, email: true },
  });
  if (!owner) {
    return NextResponse.json({ ok: false, error: 'No org owner found' }, { status: 400 });
  }

  // Resolve the target member's name (for the DM chat name)
  let targetName: string;
  if (parsed.withMemberKind === 'agent') {
    const agent = await db.agent.findUnique({
      where: { id: parsed.withMemberId },
      select: { name: true },
    });
    targetName = agent?.name ?? 'Unknown';
  } else {
    const user = await db.user.findUnique({
      where: { id: parsed.withMemberId },
      select: { name: true, email: true },
    });
    targetName = user?.name ?? user?.email ?? 'Unknown';
  }

  // Deterministic slug: sort the two IDs so dm-a-b == dm-b-a
  const ids = [owner.id, parsed.withMemberId].sort();
  const slug = `dm-${ids[0]}-${ids[1]}`;
  const chatId = `chat-${slug}`;

  // Find or create the DM chat (stored in Channel table with isDm=true)
  const existing = await db.channel.findUnique({ where: { id: chatId } });
  if (existing) {
    // Return as "chat" — never expose "channel" naming to the client
    return NextResponse.json({ ok: true, chat: { ...existing, isChat: true } });
  }

  // Create a new DM chat (isDm=true, no team)
  const chat = await db.channel.create({
    data: {
      id: chatId,
      tenantId: org.tenantId,
      orgId: org.id,
      teamId: null,
      name: targetName,
      slug,
      topic: `Direct message with ${targetName}`,
      isDm: true,
    },
  });

  // Return as "chat" — the UI never refers to these as channels
  return NextResponse.json({ ok: true, chat: { ...chat, isChat: true } });
}
