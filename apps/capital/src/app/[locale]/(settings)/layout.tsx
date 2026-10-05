import { WorkspaceProviders } from "@/components/shell/workspace-providers";

/** Ajustes: a full page without the sidebar ("← Voltar ao app" returns to the last app URL). */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceProviders>{children}</WorkspaceProviders>;
}
