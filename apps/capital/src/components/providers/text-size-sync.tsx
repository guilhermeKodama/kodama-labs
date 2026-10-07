"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/api/session";
import { applyTextSize, parseTextSize } from "@/lib/theme/text-size";

/**
 * Applies the signed-in user's text size (Ajustes › Perfil › Tamanho da
 * letra) once the session loads and whenever it changes, and keeps it in
 * localStorage so the next load starts at that size before /me answers
 * (the inline script of app/[locale]/layout.tsx).
 */
export function TextSizeSync() {
  const size = parseTextSize(useSession().data?.textSize);

  useEffect(() => {
    if (size) applyTextSize(size);
  }, [size]);

  return null;
}
