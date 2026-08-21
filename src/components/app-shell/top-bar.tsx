// AI Org OS — Top bar
// Logo, tenant switcher, org switcher, theme toggle, help.

'use client';

import { HelpCircle, Boxes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { TenantSwitcher } from '@/components/common/tenant-switcher';
import { OrgSwitcher } from '@/components/common/org-switcher';

interface TopBarProps {
  tenantName: string;
  orgName: string;
  onHelp?: () => void;
}

export function TopBar({ tenantName, orgName, onHelp }: TopBarProps) {
  return (
    <header
      className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-1 border-b px-3 backdrop-blur md:px-4"
      role="banner"
    >
      <div className="flex items-center gap-2">
        <div
          className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"
          aria-hidden
        >
          <Boxes className="size-4" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight">
            AI Org OS
          </span>
          <span className="text-[0.625rem] text-muted-foreground uppercase tracking-widest">
            v0.1
          </span>
        </div>
      </div>

      <span className="mx-2 text-border" aria-hidden>
        ·
      </span>

      <TenantSwitcher name={tenantName} />
      <span className="text-border" aria-hidden>
        ·
      </span>
      <OrgSwitcher name={orgName} />

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Help"
              onClick={onHelp}
            >
              <HelpCircle className="size-4" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Help & about</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
