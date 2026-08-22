// Vuno — useRealtime hook
// Connects to the socket.io realtime service (port 3003) via the Caddy gateway.
// Per design principles: Simple (one hook, one connection), Efficient (no polling),
// Scalable (room-based subscriptions), Beautiful (real-time UX).
//
// Usage:
//   const { isConnected, subscribe, unsubscribe } = useRealtime();
//   subscribe(channelId);
//   // listen for event:appended via the onEventAppended callback

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';

// Connect via the Caddy gateway — path is always "/", XTransformPort=3003
// per the project's gateway rules. NEVER connect directly to localhost:3003.
const SOCKET_URL = '/';
const SOCKET_OPTIONS = {
  path: '/',
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
};

let globalSocket: Socket | null = null;

function getSocket(): Socket {
  if (!globalSocket) {
    globalSocket = io(SOCKET_URL, {
      ...SOCKET_OPTIONS,
      // Caddy uses the XTransformPort query param to forward to port 3003
      query: { XTransformPort: '3003' },
    });
  }
  return globalSocket;
}

interface UseRealtimeOptions {
  onEventAppended?: (data: {
    channelId?: string;
    scopeType?: string;
    scopeId?: string;
    event: unknown;
  }) => void;
  onTyping?: (data: {
    channelId?: string;
    scopeType?: string;
    scopeId?: string;
    userId: string;
    isTyping: boolean;
  }) => void;
}

export function useRealtime(opts: UseRealtimeOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const optsRef = useRef(opts);
  // Update the ref inside an effect (not during render) to satisfy react-hooks/refs
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setIsConnected(true);
      console.log('[realtime] connected');
    };
    const onDisconnect = () => {
      setIsConnected(false);
      console.log('[realtime] disconnected');
    };
    const onEventAppended = (data: unknown) => {
      optsRef.current.onEventAppended?.(data as Parameters<NonNullable<UseRealtimeOptions['onEventAppended']>>[0]);
    };
    const onTyping = (data: unknown) => {
      optsRef.current.onTyping?.(data as Parameters<NonNullable<UseRealtimeOptions['onTyping']>>[0]);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('event:appended', onEventAppended);
    socket.on('typing', onTyping);

    if (socket.connected) {
      // Defer to avoid synchronous setState in effect (react-hooks/set-state-in-effect)
      queueMicrotask(() => setIsConnected(true));
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('event:appended', onEventAppended);
      socket.off('typing', onTyping);
      // Note: we do NOT disconnect the socket — it's a singleton, reused across views.
      // The socket lifecycle is tied to the app, not individual components.
    };
  }, []);

  const subscribe = useCallback((channelId: string) => {
    const socket = getSocket();
    socket.emit('subscribe', channelId);
  }, []);

  const unsubscribe = useCallback((channelId: string) => {
    const socket = getSocket();
    socket.emit('unsubscribe', channelId);
  }, []);

  const sendTyping = useCallback((channelId: string, userId: string, isTyping: boolean) => {
    const socket = getSocket();
    socket.emit('typing', { channelId, userId, isTyping });
  }, []);

  return { isConnected, subscribe, unsubscribe, sendTyping };
}
