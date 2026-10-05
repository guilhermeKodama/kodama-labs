import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceProviders } from "@/components/shell/workspace-providers";

/** Screens with the sidebar. The shell stays mounted while the user moves between them. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProviders>
      <AppShell>{children}</AppShell>
    </WorkspaceProviders>
  );
}
