"use client";

import { useSyncExternalStore } from "react";
import { APP_HOME, lastAppUrl, sessionStore } from "./last-app-url";

const noSubscribe = () => () => {};

/** Where Ajustes' "← Voltar ao app" and Esc go: this tab's last app URL (/transactions without one). */
export function useLastAppUrl(): string {
  return useSyncExternalStore(noSubscribe, () => lastAppUrl(sessionStore()), () => APP_HOME);
}
