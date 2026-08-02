'use client';

import { LogOut, Menu } from 'lucide-react';
import { ThemeToggle } from './theme';
import { Button } from './ui/button';
import { useAuth } from '@/lib/auth';

export function Topbar({
  title,
  onMenu,
  menuOpen = false,
}: {
  title: string;
  onMenu?: () => void;
  menuOpen?: boolean;
}) {
  const { user, logout } = useAuth();
  const initials = (user?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenu}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-base font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <div className="ml-1 flex items-center gap-2.5 rounded-full border border-border py-1 pl-1 pr-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials}
          </span>
          <span className="hidden text-sm sm:inline">{user?.name}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
