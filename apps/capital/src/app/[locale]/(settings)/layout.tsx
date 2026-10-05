import { CommandMenu } from "@/components/shell/command";
import { WorkspaceProviders } from "@/components/shell/workspace-providers";

/**
 * Ajustes: a full page without the sidebar ("← Voltar ao app" returns to
 * the last app URL). ⌘K still works here, as on every signed-in page.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProviders>
      {children}
      <CommandMenu />
    </WorkspaceProviders>
  );
}
