"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

// How long after a fresh page load or a foreground resume an update is
// still considered part of "just opened the app" — reload silently. Past
// that window, an update means a deploy landed while the app was already
// in active use, so we ask before reloading instead of yanking the screen
// out from under whatever the user is doing.
const SILENT_RELOAD_WINDOW_MS = 10_000;
// Backstop for a tab/PWA that stays in the foreground for a long stretch
// without ever backgrounding — visibilitychange alone would never re-check.
const BACKGROUND_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function PwaRegister() {
  const t = useTranslations("pwa");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;
    // A controllerchange also fires the very first time this SW activates
    // (clients.claim() during "activate" claims the page that just
    // registered it) — that's an install, not an update, and must not
    // trigger a reload or every first visit would loop.
    let hadController = !!navigator.serviceWorker.controller;
    let silentUntil = Date.now() + SILENT_RELOAD_WINDOW_MS;

    const checkForUpdate = () => {
      registration?.update().catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      silentUntil = Date.now() + SILENT_RELOAD_WINDOW_MS;
      checkForUpdate();
    };

    const handleControllerChange = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (Date.now() < silentUntil) {
        window.location.reload();
        return;
      }
      toast(t("updateAvailable"), {
        action: { label: t("reload"), onClick: () => window.location.reload() },
        duration: Infinity,
      });
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = window.setInterval(checkForUpdate, BACKGROUND_CHECK_INTERVAL_MS);

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [t]);

  return null;
}
