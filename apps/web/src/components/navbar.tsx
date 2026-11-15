'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Moon, Sun } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/components/theme-provider';

function SeatMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect x="4" y="1.5" width="12" height="8" rx="3.2" fill="currentColor" />
      <rect x="2" y="9" width="16" height="8.5" rx="3" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

const ROLE_LABEL: Record<string, string> = {
  ORGANIZER: 'Organizer',
  STAFF: 'Staff',
  CUSTOMER: '',
};

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, mounted, toggleTheme } = useTheme();

  const { data } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch('/api/auth/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const user = data?.user;

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // cookie will simply expire; still clear local state below
    }
    queryClient.clear();
    router.push('/login');
    router.refresh();
  }

  const links = [
    { href: '/', label: 'Events' },
    { href: '/my-tickets', label: 'My tickets' },
    ...(user?.role === 'STAFF' || user?.role === 'ORGANIZER'
      ? [{ href: '/staff/scanner', label: 'Scanner' }]
      : []),
    ...(user?.role === 'ORGANIZER' ? [{ href: '/organizer', label: 'Dashboard' }] : []),
  ];

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/events') : pathname.startsWith(href);

  const roleLabel = user ? ROLE_LABEL[user.role] : '';

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md no-print">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-3.5 sm:px-6">
        <div className="flex items-center gap-4 sm:gap-8 min-w-0">
          <Link href="/" className="group flex shrink-0 items-center gap-2" aria-label="SeatLock home">
            <SeatMark className="h-[18px] w-[18px] text-accent transition-transform group-hover:-translate-y-px" />
            <span className="font-display text-[19px] sm:text-[20px] font-extrabold leading-none tracking-tight">
              SeatLock
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? 'page' : undefined}
                className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive(link.href) ? 'text-ink font-semibold' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {link.label}
                {isActive(link.href) && (
                  <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-accent" />
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="btn btn-ghost !p-2 min-h-[38px] min-w-[38px]"
          >
            {/* Render a neutral icon until mounted so server and client markup match */}
            {mounted && theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {user ? (
            <>
              <div className="ml-1 hidden items-center gap-2 text-[13px] sm:flex">
                <span className="max-w-[180px] truncate text-ink-2">{user.email}</span>
                {roleLabel && <span className="tag">{roleLabel}</span>}
              </div>
              {/* Mobile indicator for logged-in user */}
              <div className="flex items-center gap-1 sm:hidden">
                <span className="max-w-[85px] truncate text-[11px] font-medium text-ink-3">
                  {user.email.split('@')[0]}
                </span>
                {roleLabel && <span className="tag text-[9px] px-1.5 py-0">{roleLabel}</span>}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="btn btn-ghost btn-sm min-h-[36px] min-w-[36px] !px-2 sm:!px-3"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          ) : (
            <Link href="/login" className="btn btn-primary btn-sm min-h-[36px] px-3.5">
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/* Small screens: same links, smooth scrollable row under the bar */}
      <nav
        className="no-scrollbar flex gap-1.5 overflow-x-auto border-t border-line px-3.5 py-1.5 md:hidden"
        aria-label="Main mobile"
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive(link.href) ? 'page' : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              isActive(link.href)
                ? 'bg-accent-soft text-accent font-semibold'
                : 'text-ink-3 hover:bg-sunken hover:text-ink'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
