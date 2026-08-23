// Vuno — Appearance store (Zustand + localStorage)
// Per the "Beautiful" principle: let users customize the accent color, density,
// and font size. Persisted to localStorage so preferences survive reloads.
//
// The accent color overrides the --primary CSS variable. The density controls
// padding/spacing. The font size controls the base rem.

import { create } from 'zustand';

export type AccentColor = 'mustard' | 'amber' | 'sky' | 'emerald' | 'red-orange' | 'purple';
export type Density = 'comfortable' | 'compact';
export type FontSize = 'small' | 'medium' | 'large';

export interface AccentPreset {
  id: AccentColor;
  label: string;
  // Light mode --primary (oklch)
  light: string;
  // Dark mode --primary (oklch)
  dark: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'mustard',
    label: 'Mustard (default)',
    light: 'oklch(0.52 0.13 70)',
    dark: 'oklch(0.70 0.14 75)',
  },
  {
    id: 'amber',
    label: 'Amber',
    light: 'oklch(0.55 0.13 60)',
    dark: 'oklch(0.72 0.14 65)',
  },
  {
    id: 'sky',
    label: 'Sky',
    light: 'oklch(0.50 0.13 230)',
    dark: 'oklch(0.68 0.14 235)',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    light: 'oklch(0.50 0.12 145)',
    dark: 'oklch(0.68 0.13 150)',
  },
  {
    id: 'red-orange',
    label: 'Red-Orange',
    light: 'oklch(0.55 0.20 25)',
    dark: 'oklch(0.70 0.18 25)',
  },
  {
    id: 'purple',
    label: 'Purple',
    light: 'oklch(0.50 0.13 300)',
    dark: 'oklch(0.68 0.14 305)',
  },
];

interface AppearanceState {
  accent: AccentColor;
  density: Density;
  fontSize: FontSize;
  setAccent: (a: AccentColor) => void;
  setDensity: (d: Density) => void;
  setFontSize: (f: FontSize) => void;
}

const STORAGE_KEY = 'vuno-appearance';

function loadFromStorage(): Partial<AppearanceState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<AppearanceState>;
  } catch {
    return {};
  }
}

function saveToStorage(state: { accent: AccentColor; density: Density; fontSize: FontSize }) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const saved = loadFromStorage();

export const useAppearanceStore = create<AppearanceState>((set) => ({
  accent: saved.accent ?? 'mustard',
  density: saved.density ?? 'comfortable',
  fontSize: saved.fontSize ?? 'medium',
  setAccent: (accent) => {
    set((s) => {
      const next = { accent, density: s.density, fontSize: s.fontSize };
      saveToStorage(next);
      return { accent };
    });
  },
  setDensity: (density) => {
    set((s) => {
      const next = { accent: s.accent, density, fontSize: s.fontSize };
      saveToStorage(next);
      return { density };
    });
  },
  setFontSize: (fontSize) => {
    set((s) => {
      const next = { accent: s.accent, density: s.density, fontSize };
      saveToStorage(next);
      return { fontSize };
    });
  },
}));

// Apply the appearance settings to the document root as CSS variables + data attributes.
// Call this in a useEffect on the client.
export function applyAppearance(accent: AccentColor, density: Density, fontSize: FontSize) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const preset = ACCENT_PRESETS.find((p) => p.id === accent) ?? ACCENT_PRESETS[0]!;
  // Override --primary for both light + dark (next-themes handles the .dark class)
  root.style.setProperty('--primary', preset.light);
  root.style.setProperty('--sidebar-primary', preset.light);
  root.style.setProperty('--ring', `${preset.light.replace(')', ' / 40%)')}`);
  root.style.setProperty('--sidebar-ring', `${preset.light.replace(')', ' / 40%)')}`);

  // For dark mode, override via a style tag (since :root vs .dark specificity)
  let darkStyle = document.getElementById('vuno-dark-accent');
  if (!darkStyle) {
    darkStyle = document.createElement('style');
    darkStyle.id = 'vuno-dark-accent';
    document.head.appendChild(darkStyle);
  }
  darkStyle.textContent = `.dark { --primary: ${preset.dark}; --sidebar-primary: ${preset.dark}; }`;

  // Density
  root.setAttribute('data-density', density);

  // Font size
  root.setAttribute('data-font-size', fontSize);
}
