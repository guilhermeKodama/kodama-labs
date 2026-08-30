import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { UserProvider } from "@/lib/user-context";
import { PwaRegister } from "@/components/pwa-register";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Capital - Financial Management",
  description: "Financial management for international service providers. Track your business and personal finances with multi-currency support.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Capital" },
  // No `manifest` field here — Next's Metadata API only accepts a string/URL
  // for it, with no way to set crossOrigin. See the <link> below instead.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        {/* crossOrigin="use-credentials": the whole app sits behind Cloudflare
            Access, and a manifest fetch without cookies gets redirected to the
            Access login page — see manifest.webmanifest/route.ts for the full
            explanation. React 19 hoists this into <head> on its own. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <PwaRegister />
        <UserProvider>{children}</UserProvider>
      </body>
    </html>
  );
}
