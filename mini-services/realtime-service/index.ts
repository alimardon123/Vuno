// Vuno — Realtime service (socket.io on port 3003)
// Per the user's design principles: Simple, Powerful, Performant, Scalable, Efficient.
//
// This is the real-time TRANSPORT layer. It does NOT own the event spine —
// the Next.js API routes own the spine (and in Round 5, the Rust substrate
// will own it). This service just:
//   1. Receives 'broadcast' emits from Next.js API routes (via socket.io client)
//   2. Fans out those events to all connected UI clients instantly
//
// Why socket.io client-emit instead of a separate HTTP endpoint:
// - Simpler: no separate HTTP server, no port collision
// - More efficient: single transport (socket.io), no HTTP overhead per broadcast
// - Scalable: the Next.js API can be a long-lived client, reconnects automatically
//
// Architecture (Architect's view):
// - Next.js API (port 3000) — owns the spine, appends events, emits 'broadcast' as a socket.io client
// - This service (port 3003) — fans out 'broadcast' to all connected UI clients
// - UI — connects via io("/?XTransformPort=3003"), listens for "event:appended"

import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = 3003;

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — Caddy uses it to forward to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Track connected clients (for presence + debugging)
const connectedClients = new Map<string, { channels: Set<string>; connectedAt: Date; isServer: boolean }>();

io.on('connection', (socket) => {
  const clientId = socket.id;
  const isServer = socket.handshake.auth?.role === 'server';
  connectedClients.set(clientId, { channels: new Set(), connectedAt: new Date(), isServer });

  if (isServer) {
    console.log(`[realtime] server client connected: ${clientId}`);
  } else {
    console.log(`[realtime] UI client connected: ${clientId} (${connectedClients.size} total)`);
  }

  // UI client subscribes to a channel's events
  socket.on('subscribe', (channelId: string) => {
    if (typeof channelId !== 'string') return;
    const client = connectedClients.get(clientId);
    if (client) client.channels.add(channelId);
    socket.join(`channel:${channelId}`);
  });

  // UI client unsubscribes from a channel
  socket.on('unsubscribe', (channelId: string) => {
    if (typeof channelId !== 'string') return;
    const client = connectedClients.get(clientId);
    if (client) client.channels.delete(channelId);
    socket.leave(`channel:${channelId}`);
  });

  // Typing indicator — UI client is typing in a channel
  socket.on('typing', (data: { channelId: string; userId: string; isTyping: boolean }) => {
    if (!data || typeof data.channelId !== 'string') return;
    // Broadcast to everyone in the channel EXCEPT the sender
    socket.to(`channel:${data.channelId}`).emit('typing', data);
  });

  // Server client emits 'broadcast' to fan out an event to all UI clients
  socket.on('broadcast', (data: {
    channelId?: string;
    scopeType?: string;
    scopeId?: string;
    event?: unknown;
    typing?: { userId: string; isTyping: boolean };
  }) => {
    if (!data) return;

    // Typing notification
    if (data.typing) {
      const roomId = data.channelId
        ? `channel:${data.channelId}`
        : `scope:${data.scopeType}:${data.scopeId}`;
      io.to(roomId).emit('typing', {
        channelId: data.channelId,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        userId: data.typing.userId,
        isTyping: data.typing.isTyping,
      });
      return;
    }

    // Event broadcast
    if (data.event) {
      const roomId = data.channelId
        ? `channel:${data.channelId}`
        : `scope:${data.scopeType}:${data.scopeId}`;
      io.to(roomId).emit('event:appended', {
        channelId: data.channelId,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        event: data.event,
      });
      console.log(`[realtime] broadcast event to room ${roomId}`);
    }
  });

  socket.on('disconnect', () => {
    connectedClients.delete(clientId);
    if (!isServer) {
      console.log(`[realtime] UI client disconnected: ${clientId} (${connectedClients.size} total)`);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[realtime] Vuno realtime service listening on port ${PORT}`);
  console.log('[realtime] socket.io path: / (for Caddy XTransformPort forwarding)');
  console.log('[realtime] server clients emit "broadcast" to fan out events');
});
