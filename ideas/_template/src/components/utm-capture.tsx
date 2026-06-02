"use client";

import { useEffect } from "react";
import { captureUtms } from "@/lib/utm";

export function UtmCapture() {
  useEffect(() => {
    captureUtms();
  }, []);
  return null;
}
