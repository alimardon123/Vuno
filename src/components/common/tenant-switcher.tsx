// AI Org OS — Tenant switcher (v1: shows current only, "coming in v2" tooltip).

'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Building2, ChevronDown, Lock } from 'lucide-react';

interface TenantSwitcherProps {
  name: string;
}

export function TenantSwitcher({ name }: TenantSwitcherProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 text-sm font-normal text-muted-foreground"
          aria-label={`Tenant: ${name} (multi-tenant switching is coming in v2)`}
          disabled
        >
          <Building2 className="size-3.5" aria-hidden />
          <span className="max-w-[8rem] truncate">{name}</span>
          <Lock className="size-3 opacity-60" aria-hidden />
          <ChevronDown className="size-3 opacity-40" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Tenant: {name} · multi-tenant switching comes in v2
      </TooltipContent>
    </Tooltip>
  );
}
