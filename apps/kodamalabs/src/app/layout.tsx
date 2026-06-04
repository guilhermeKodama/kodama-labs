import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://kodamalabs.ai"),
  title: {
    default: "Kodama Labs — Software with intent",
    template: "%s · Kodama Labs",
  },
  description:
    "An umbrella for ambitious software products. Where ideas turn into shipped software — and shipped software turns into impact.",
  openGraph: {
    title: "Kodama Labs",
    description:
      "An umbrella for ambitious software products. Where ideas turn into shipped software — and shipped software turns into impact.",
    url: "https://kodamalabs.ai",
    siteName: "Kodama Labs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kodama Labs",
    description: "An umbrella for ambitious software products.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
