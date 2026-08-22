// Vuno — Top-level UI state (Zustand).
// Per ADR-0001: ephemeral client UI state (active view, channel, decision, ledger filters, dialog open-states).

import { create } from 'zustand';
import type { ClaimStatus } from '@/lib/events/types';

export type ActiveView = 'chat' | 'decision' | 'ledger' | 'agents' | 'wiki' | 'hr';

// Left-rail panel switcher (Teams-style: Chats / Org / Settings)
export type LeftPanel = 'chats' | 'org' | 'settings';

export interface LedgerFilters {
  status: ClaimStatus[]; // multi-select; empty = all
  actorId: string | null; // null = all
  scopeId: string | null; // project scope; null = all
}

interface AppState {
  // view orchestration
  activeView: ActiveView;
  activeChannelId: string | null;
  activeDecisionId: string | null;

  // left-rail panel (Chats / Org / Settings)
  leftPanel: LeftPanel;

  // ledger filters
  ledgerFilters: LedgerFilters;

  // mobile rail open states (sheet)
  leftRailOpen: boolean;
  rightRailOpen: boolean;

  // dialog open states
  installAgentOpen: boolean;
  fileObjectiveOpen: boolean;

  // transient: signal a chat refresh after posting a message
  chatNonce: number;

  // actions
  setView: (v: ActiveView) => void;
  setActiveChannel: (id: string) => void;
  setActiveDecision: (id: string) => void;
  setLeftPanel: (p: LeftPanel) => void;
  setLedgerFilter: <K extends keyof LedgerFilters>(
    key: K,
    value: LedgerFilters[K],
  ) => void;
  toggleLedgerStatus: (s: ClaimStatus) => void;
  resetLedgerFilters: () => void;
  setLeftRailOpen: (open: boolean) => void;
  setRightRailOpen: (open: boolean) => void;
  setInstallAgentOpen: (open: boolean) => void;
  setFileObjectiveOpen: (open: boolean) => void;
  bumpChatNonce: () => void;
}

const DEFAULT_LEDGER_FILTERS: LedgerFilters = {
  status: [],
  actorId: null,
  scopeId: null,
};

export const useAppStore = create<AppState>((set) => ({
  activeView: 'chat',
  activeChannelId: null,
  activeDecisionId: null,

  leftPanel: 'chats',

  ledgerFilters: DEFAULT_LEDGER_FILTERS,

  leftRailOpen: false,
  rightRailOpen: false,

  installAgentOpen: false,
  fileObjectiveOpen: false,

  chatNonce: 0,

  setView: (v) => set({ activeView: v }),
  setActiveChannel: (id) =>
    set({ activeChannelId: id, activeView: 'chat', activeDecisionId: null }),
  setActiveDecision: (id) =>
    set({ activeDecisionId: id, activeView: 'decision' }),
  setLeftPanel: (p) => set({ leftPanel: p }),
  setLedgerFilter: (key, value) =>
    set((s) => ({
      ledgerFilters: { ...s.ledgerFilters, [key]: value },
    })),
  toggleLedgerStatus: (s) =>
    set((state) => {
      const cur = state.ledgerFilters.status;
      const next = cur.includes(s)
        ? cur.filter((x) => x !== s)
        : [...cur, s];
      return {
        ledgerFilters: { ...state.ledgerFilters, status: next },
      };
    }),
  resetLedgerFilters: () => set({ ledgerFilters: DEFAULT_LEDGER_FILTERS }),
  setLeftRailOpen: (open) => set({ leftRailOpen: open }),
  setRightRailOpen: (open) => set({ rightRailOpen: open }),
  setInstallAgentOpen: (open) => set({ installAgentOpen: open }),
  setFileObjectiveOpen: (open) => set({ fileObjectiveOpen: open }),
  bumpChatNonce: () => set((s) => ({ chatNonce: s.chatNonce + 1 })),
}));
