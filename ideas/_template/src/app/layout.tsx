import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Analytics } from "@/lib/analytics";
import { UtmCapture } from "@/components/utm-capture";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "{{IDEA_NAME}}",
  description: "{{IDEA_NAME}} — validation prototype.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} font-sans antialiased`}>
        <Analytics />
        <UtmCapture />
        {children}
      </body>
    </html>
  );
}
