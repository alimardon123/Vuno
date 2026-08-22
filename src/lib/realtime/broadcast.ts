// Vuno — Server-side realtime broadcast helpers
// This file is SERVER-ONLY (no 'use client'). Used by Next.js API routes
// to notify the realtime service (port 3003) that events were appended.

import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

let serverSocket: ClientSocket | null = null;
let serverSocketPromise: Promise<ClientSocket> | null = null;

function getServerSocket(): Promise<ClientSocket> {
  if (serverSocket && serverSocket.connected) return Promise.resolve(serverSocket);
  if (serverSocketPromise) return serverSocketPromise;

  serverSocketPromise = new Promise<ClientSocket>((resolve) => {
    const sock = ioClient('http://localhost:3003', {
      path: '/',
      auth: { role: 'server' },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });

    sock.on('connect', () => {
      console.log('[realtime] server socket connected to realtime service');
      serverSocket = sock;
      resolve(sock);
    });

    sock.on('disconnect', () => {
      console.warn('[realtime] server socket disconnected');
      serverSocket = null;
    });

    setTimeout(() => {
      if (!serverSocket) {
        serverSocket = sock;
        resolve(sock);
      }
    }, 1000);
  });

  return serverSocketPromise;
}

export async function broadcastEventAppended(data: {
  channelId?: string;
  scopeType?: string;
  scopeId?: string;
  event: unknown;
}): Promise<void> {
  try {
    const sock = await getServerSocket();
    sock.emit('broadcast', data);
  } catch (err) {
    console.warn('[realtime] broadcast failed (service might be down):', err);
  }
}

export async function broadcastTyping(data: {
  channelId?: string;
  scopeType?: string;
  scopeId?: string;
  userId: string;
  isTyping: boolean;
}): Promise<void> {
  try {
    const sock = await getServerSocket();
    sock.emit('broadcast', { ...data, typing: { userId: data.userId, isTyping: data.isTyping } });
  } catch (err) {
    console.warn('[realtime] typing broadcast failed:', err);
  }
}
