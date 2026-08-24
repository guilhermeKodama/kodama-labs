import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppSidebar } from "@/components/sidebar";
import { getSidebarCounts } from "@/server/modules/dashboard-counts";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "careers — busca de vagas",
  description: "Sistema de busca e tracking de vagas de emprego.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const defaultCollapsed = cookieStore.get("careers_sidebar_collapsed")?.value === "1";
  const counts = await getSidebarCounts();

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
            <AppSidebar defaultCollapsed={defaultCollapsed} counts={counts} />
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
          </div>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
