// AI Org OS — Theme toggle (dark ↔ light).

'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun, Laptop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSyncExternalStore } from 'react';

// A tiny subscription that flips to true once the client has mounted,
// without calling setState synchronously in an effect (which trips lint).
const mountedSubscribers = new Set<() => void>();
let mounted = false;
function subscribe(cb: () => void) {
  mountedSubscribers.add(cb);
  if (!mounted) {
    mounted = true;
    // Defer to next tick — the subscription will be invoked after mount.
    queueMicrotask(() => {
      for (const fn of mountedSubscribers) fn();
    });
  }
  return () => {
    mountedSubscribers.delete(cb);
  };
}
function getSnapshot() {
  return mounted;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isMounted = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false, // server snapshot = false
  );
  const isDark = theme === 'dark';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        >
          {isMounted ? (
            isDark ? (
              <Sun className="size-4" aria-hidden />
            ) : (
              <Moon className="size-4" aria-hidden />
            )
          ) : (
            <Laptop className="size-4" aria-hidden />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Toggle theme</TooltipContent>
    </Tooltip>
  );
}
