"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function FilaAutoRefresh({
  badgeCount,
  intervalMs = 5_000,
}: {
  badgeCount: number;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  useEffect(() => {
    const nav = navigator as BadgeNavigator;
    if (badgeCount > 0) {
      nav.setAppBadge?.(badgeCount).catch(() => {});
    } else {
      nav.clearAppBadge?.().catch(() => {});
    }
  }, [badgeCount]);

  return null;
}
