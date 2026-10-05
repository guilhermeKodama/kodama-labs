"use client";

import type { ReactNode } from "react";
import { CommandMenu } from "@/components/shell/command";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <CommandMenu />
    </>
  );
}
