'use client';

// The call.
//
// A mesh: every participant opens a peer connection to every other, so the
// media goes browser to browser and never touches this server. That is why
// there is a participant cap — at six people each browser is encoding five
// outbound streams, and the next honest step is an SFU, which is a server that
// somebody has to run.
//
// The one piece of protocol worth stating, because getting it wrong produces a
// call that connects half the time: **who offers.** Two browsers that both send
// an offer at the same moment end up in a state neither can answer — "glare".
// The rule here is that the member with the lower id offers, and the other
// waits. It needs no coordination, both sides compute the same answer, and it
// is stable across reconnects.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Avatar } from '@/components/vuno/primitives';

export interface CallMember {
  id: string;
  displayName: string;
  kind: 'human' | 'agent';
}

export interface LiveCall {
  id: string;
  channelId: string;
  startedAt: string;
  startedBy: { id: string; displayName: string } | null;
  participants: CallMember[];
}

interface IceConfig {
  iceServers: RTCIceServer[];
  limitation: string | null;
}

/** How often to ask for signals. Fast while connecting, then it barely matters. */
const POLL_MS = 900;

export function CallSurface({
  call,
  ice,
  viewerId,
  members,
  onLeave,
}: {
  call: LiveCall;
  ice: IceConfig;
  viewerId: string;
  /** Everyone who could be in this conversation, for names and avatars. */
  members: CallMember[];
  onLeave: () => void;
}) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [present, setPresent] = useState<string[]>([call.id ? viewerId : viewerId]);
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [status, setStatus] = useState<'connecting' | 'live' | 'failed'>('connecting');
  const [elapsed, setElapsed] = useState(0);

  const local = useRef<MediaStream | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const lastSignal = useRef(0);
  const stopped = useRef(false);
  const { toast } = useToast();
  const router = useRouter();

  const nameOf = useCallback(
    (id: string) => members.find((m) => m.id === id) ?? { id, displayName: 'Someone', kind: 'human' as const },
    [members],
  );

  const post = useCallback(
    async (to: string, kind: string, payload: unknown) => {
      await fetch('/api/calls/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: call.id, to, kind, payload }),
      }).catch(() => {});
    },
    [call.id],
  );

  /** Open (or find) the connection to one peer, wired to send its own candidates. */
  const connectionTo = useCallback(
    (peerId: string): RTCPeerConnection => {
      const existing = peers.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ice.iceServers });
      peers.current.set(peerId, pc);

      for (const track of local.current?.getTracks() ?? []) {
        pc.addTrack(track, local.current as MediaStream);
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) void post(peerId, 'candidate', e.candidate.toJSON());
      };
      pc.ontrack = (e) => {
        setStreams((prev) => ({ ...prev, [peerId]: e.streams[0] }));
        setStatus('live');
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          // Named, not swallowed: this is the case the missing relay causes,
          // and "the call did not work" is not something anyone can act on.
          setStatus('failed');
        }
      };
      return pc;
    },
    [ice.iceServers, post],
  );

  // ── Media, then the loop ──────────────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Reset on every mount, not just the first. React mounts, cleans up and
    // remounts an effect in development; without this the cleanup set the flag
    // and the second mount's loop stopped on its first tick — two browsers
    // holding local video and never polling for each other.
    stopped.current = false;

    async function begin() {
      try {
        local.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch {
        // Audio-only is a real call. Refusing to start because there is no
        // camera would be worse than starting without one.
        try {
          local.current = await navigator.mediaDevices.getUserMedia({ audio: true });
          setCameraOff(true);
        } catch {
          toast({
            title: 'No microphone',
            description: 'The browser blocked it, or another app has it.',
            variant: 'destructive',
          });
          onLeave();
          return;
        }
      }
      if (localVideo.current && local.current) localVideo.current.srcObject = local.current;

      const tick = async () => {
        if (stopped.current) return;
        try {
          const res = await fetch(`/api/calls/signal?callId=${call.id}&after=${lastSignal.current}`);
          const data = (await res.json()) as {
            ok?: boolean;
            present?: string[];
            signals?: Array<{ id: number; from: string; kind: string; payload: unknown }>;
          };
          if (data.ok && data.present) {
            setPresent(data.present);

            // Offer to everyone I outrank, once each. The lower id offers, so
            // both sides agree without asking who goes first.
            for (const peerId of data.present) {
              if (peerId === viewerId || peers.current.has(peerId)) continue;
              if (viewerId < peerId) {
                const pc = connectionTo(peerId);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                await post(peerId, 'offer', offer);
              }
            }
          }

          for (const s of data.signals ?? []) {
            lastSignal.current = Math.max(lastSignal.current, s.id);
            const pc = connectionTo(s.from);

            if (s.kind === 'offer') {
              await pc.setRemoteDescription(s.payload as RTCSessionDescriptionInit);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await post(s.from, 'answer', answer);
            } else if (s.kind === 'answer') {
              // Only when we are the side that offered and are still waiting;
              // otherwise this throws and takes the loop with it.
              if (pc.signalingState === 'have-local-offer') {
                await pc.setRemoteDescription(s.payload as RTCSessionDescriptionInit);
              }
            } else if (s.kind === 'candidate') {
              await pc.addIceCandidate(s.payload as RTCIceCandidateInit).catch(() => {});
            } else if (s.kind === 'bye') {
              pc.close();
              peers.current.delete(s.from);
              setStreams((prev) => {
                const next = { ...prev };
                delete next[s.from];
                return next;
              });
            }
          }
        } catch {
          // A dropped poll is not a dropped call. The next one catches up.
        }
        if (!stopped.current) timer = setTimeout(() => void tick(), POLL_MS);
      };

      void tick();
    }

    void begin();

    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
      for (const [, pc] of peers.current) pc.close();
      peers.current.clear();
      // Every track, or the browser keeps the camera light on after the call.
      for (const track of local.current?.getTracks() ?? []) track.stop();
      local.current = null;
    };
     
  }, [call.id]);

  useEffect(() => {
    const started = new Date(call.startedAt).getTime();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1_000);
    return () => clearInterval(t);
  }, [call.startedAt]);

  function toggleMute() {
    const on = !muted;
    for (const track of local.current?.getAudioTracks() ?? []) track.enabled = !on;
    setMuted(on);
  }

  function toggleCamera() {
    const off = !cameraOff;
    for (const track of local.current?.getVideoTracks() ?? []) track.enabled = !off;
    setCameraOff(off);
  }

  async function hangUp() {
    for (const peerId of peers.current.keys()) void post(peerId, 'bye', null);
    await fetch('/api/calls', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: call.id }),
    }).catch(() => {});
    onLeave();
    router.refresh();
  }

  const others = present.filter((id) => id !== viewerId);

  return (
    <section
      aria-label="Call"
      className="flex shrink-0 flex-col gap-2 border-b border-[var(--line)] bg-[var(--sunken)] px-4 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'size-2 rounded-full',
            status === 'live' ? 'bg-[var(--tested)]' : status === 'failed' ? 'bg-[var(--falsified)]' : 'animate-pulse bg-[var(--asserted)]',
          )}
          aria-hidden
        />
        <span className="text-[11.5px] font-semibold text-[var(--fg)]">
          {status === 'failed' ? 'Call failed' : others.length === 0 ? 'Waiting for someone to join' : 'In a call'}
        </span>
        <span className="tnum text-[11px] text-[var(--fg-4)]">
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Control label={muted ? 'Unmute' : 'Mute'} pressed={muted} onClick={toggleMute}>
            {muted ? <MicOffIcon /> : <MicIcon />}
          </Control>
          <Control label={cameraOff ? 'Turn camera on' : 'Turn camera off'} pressed={cameraOff} onClick={toggleCamera}>
            {cameraOff ? <CameraOffIcon /> : <CameraIcon />}
          </Control>
          <button
            type="button"
            onClick={() => void hangUp()}
            className="rounded-md border border-falsified bg-[var(--falsified-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--falsified)] transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
          >
            Leave
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Tile label="You" muted={muted} dark={cameraOff}>
          <video ref={localVideo} autoPlay playsInline muted className="size-full object-cover" />
        </Tile>
        {others.map((id) => (
          <Tile key={id} label={nameOf(id).displayName} kind={nameOf(id).kind} dark={!streams[id]}>
            {streams[id] ? (
              <RemoteVideo stream={streams[id]} />
            ) : (
              <span className="grid size-full place-items-center text-[10.5px] text-[var(--fg-4)]">connecting…</span>
            )}
          </Tile>
        ))}
      </div>

      {status === 'failed' && ice.limitation ? (
        <p className="rounded-md border border-falsified bg-[var(--falsified-bg)] px-2 py-1.5 text-[11px] leading-[1.5] text-[var(--falsified)]">
          {ice.limitation}
        </p>
      ) : null}
    </section>
  );
}

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline className="size-full object-cover" />;
}

function Tile({
  label,
  kind = 'human',
  muted,
  dark,
  children,
}: {
  label: string;
  kind?: 'human' | 'agent';
  muted?: boolean;
  dark?: boolean;
  children: React.ReactNode;
}) {
  return (
    <figure className="relative m-0 h-[7.5rem] w-[10rem] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--raised)]">
      {dark ? (
        <span className="grid size-full place-items-center">
          <Avatar name={label} kind={kind} size="lg" />
        </span>
      ) : (
        children
      )}
      <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/45 px-1.5 py-0.5 text-[10px] text-white">
        <span className="truncate">{label}</span>
        {muted ? <span className="ml-auto shrink-0">muted</span> : null}
      </figcaption>
    </figure>
  );
}

function Control({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'grid size-7 place-items-center rounded-md border transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        pressed
          ? 'border-falsified bg-[var(--falsified-bg)] text-[var(--falsified)]'
          : 'border-[var(--line)] text-[var(--fg-2)] hover:bg-[var(--hover)] hover:text-[var(--fg)]',
      )}
    >
      {children}
    </button>
  );
}

const I = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function MicIcon() {
  return <svg {...I}><rect x="9" y="2.5" width="6" height="11.5" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" /></svg>;
}
function MicOffIcon() {
  return <svg {...I}><path d="M3 3l18 18" /><path d="M15 9.5V5.5a3 3 0 0 0-6-.6" /><path d="M5.5 11.5a6.5 6.5 0 0 0 9.9 5.6M12 18v3.5" /></svg>;
}
function CameraIcon() {
  return <svg {...I}><rect x="2.5" y="6" width="13" height="12" rx="2" /><path d="m15.5 12 6-3.5v11l-6-3.5z" /></svg>;
}
function CameraOffIcon() {
  return <svg {...I}><path d="M3 3l18 18" /><path d="M2.5 8a2 2 0 0 1 2-2h7m4 6 6-3.5v11" /><path d="M15.5 15.5V16a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V8" /></svg>;
}
