// AI Org OS — Org switcher (v1: shows current only, "coming in v2" tooltip).

'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChevronDown, Lock, Network } from 'lucide-react';

interface OrgSwitcherProps {
  name: string;
}

export function OrgSwitcher({ name }: OrgSwitcherProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 text-sm font-normal text-foreground"
          aria-label={`Organization: ${name} (multi-org switching is coming in v2)`}
          disabled
        >
          <Network className="size-3.5" aria-hidden />
          <span className="max-w-[10rem] truncate font-medium">{name}</span>
          <Lock className="size-3 opacity-60" aria-hidden />
          <ChevronDown className="size-3 opacity-40" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Organization: {name} · multi-org switching comes in v2
      </TooltipContent>
    </Tooltip>
  );
}
