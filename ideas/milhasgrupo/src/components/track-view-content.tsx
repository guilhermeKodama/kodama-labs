"use client";

import { useEffect } from "react";
import { trackViewContent } from "@/lib/analytics";

export function TrackViewContent({ name }: { name: string }) {
  useEffect(() => {
    trackViewContent(name);
  }, [name]);
  return null;
}
