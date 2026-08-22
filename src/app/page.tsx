// Vuno — root page
// Renders the AppShell. The shell handles auto-seed, top bar, 3-column layout,
// mobile sheets, dialogs, and view orchestration via the Zustand store.

import { AppShell } from '@/components/app-shell/app-shell';

export default function Home() {
  return <AppShell />;
}
