"use client";

import { useSyncExternalStore } from "react";
import { readTextScale } from "./type-scale";

/** Re-reads --cap-text-scale only when <html data-text-size> changes. */
let cached: { size: string | undefined; scale: number } | null = null;

function snapshot(): number {
  const root = document.documentElement;
  const size = root.dataset.textSize;
  if (!cached || cached.size !== size) cached = { size, scale: readTextScale(root) };
  return cached.scale;
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-size"] });
  return () => observer.disconnect();
}

/** The current text scale (Tamanho da letra), 1 on the server and at Médio. */
export function useTextScale(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 1);
}
