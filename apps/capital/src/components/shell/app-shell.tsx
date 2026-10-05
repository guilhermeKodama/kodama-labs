"use client";

import { CommandMenu } from "@/components/shell/command-menu";
import { ShellFrame } from "@/components/shell/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ShellFrame>{children}</ShellFrame>
      <CommandMenu />
    </>
  );
}
