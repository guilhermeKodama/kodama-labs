import { AppShell } from "@/components/shell/app-shell";
import { UndoBridge } from "@/lib/api/undo-bridge";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UndoBridge />
      <AppShell>{children}</AppShell>
    </>
  );
}
