import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { UserProvider } from "@/lib/user-context";
import { PwaRegister } from "@/components/pwa-register";

// Vendored (next/font/local), not next/font/google: the google variant
// downloads fonts from fonts.googleapis.com DURING `next build`, and that
// fetch flaps inside the Docker build VM — it broke several image builds in
// a row before being pinned locally. Variable-weight latin woff2s, ~64KB.
const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk-latin-var.woff2",
  weight: "300 700",
  variable: "--font-sans",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-var.woff2",
  weight: "100 800",
  variable: "--font-mono",
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
