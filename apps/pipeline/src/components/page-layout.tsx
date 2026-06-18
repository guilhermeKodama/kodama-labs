import { MobileTopBar } from "./mobile-top-bar";
import { SidebarNav } from "./sidebar-nav";

export function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row h-dvh overflow-hidden">
      <MobileTopBar />
      <SidebarNav />
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto">
        <div className="p-4 md:p-6 lg:p-8 min-w-0">{children}</div>
      </main>
    </div>
  );
}
