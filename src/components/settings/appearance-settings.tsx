// Vuno — Appearance settings
// Per the "Beautiful" principle: let users customize accent color, density,
// and font size. Persisted to localStorage via the appearance store.

'use client';

import { useEffect } from 'react';
import { useAppearanceStore, applyAppearance, ACCENT_PRESETS, type AccentColor, type Density, type FontSize } from '@/store/appearance-store';
import { cn } from '@/lib/utils';
import { Palette, Type, Gauge, Check } from 'lucide-react';

export function AppearanceSettings() {
  const { accent, density, fontSize, setAccent, setDensity, setFontSize } = useAppearanceStore();

  // Apply the appearance settings on mount + whenever they change
  useEffect(() => {
    applyAppearance(accent, density, fontSize);
  }, [accent, density, fontSize]);

  return (
    <div className="flex flex-col gap-5">
      {/* Accent color */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Palette className="size-3.5 text-muted-foreground" aria-hidden />
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Accent Color
          </h4>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setAccent(preset.id as AccentColor)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors',
                accent === preset.id
                  ? 'border-foreground/30 bg-accent text-foreground'
                  : 'border-border/40 hover:bg-accent/50',
              )}
            >
              <span
                className="size-4 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: preset.light }}
                aria-hidden
              />
              <span className="truncate">{preset.label.split(' ')[0]}</span>
              {accent === preset.id ? <Check className="ml-auto size-3" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </section>

      {/* Font size */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Type className="size-3.5 text-muted-foreground" aria-hidden />
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Font Size
          </h4>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['small', 'medium', 'large'] as FontSize[]).map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setFontSize(size)}
              className={cn(
                'rounded-md border px-2 py-1.5 text-xs capitalize transition-colors',
                fontSize === size
                  ? 'border-foreground/30 bg-accent text-foreground'
                  : 'border-border/40 hover:bg-accent/50',
              )}
            >
              {size}
            </button>
          ))}
        </div>
      </section>

      {/* Density */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Gauge className="size-3.5 text-muted-foreground" aria-hidden />
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Density
          </h4>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['comfortable', 'compact'] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={cn(
                'rounded-md border px-2 py-1.5 text-xs capitalize transition-colors',
                density === d
                  ? 'border-foreground/30 bg-accent text-foreground'
                  : 'border-border/40 hover:bg-accent/50',
              )}
            >
              {d}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
          Compact reduces spacing for power users who want more content per screen.
        </p>
      </section>
    </div>
  );
}
