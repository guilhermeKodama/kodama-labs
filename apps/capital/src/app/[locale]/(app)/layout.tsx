import { AppShell } from '@/components/layout';

/**
 * Chrome for every authenticated screen: sidebar/bottom-nav, the
 * margin/padding-free `<main>`, and the onboarding dialog. Replaces the old
 * pattern of every page.tsx importing and wrapping itself in `<AppShell>` —
 * the shell now mounts once per navigation instead of remounting per page.
 * The centered max-width padding wrapper and the assistant's full-bleed
 * wrapper live one level down, in `(padded)/layout.tsx` and
 * `assistant/layout.tsx` respectively, since they differ per section.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
