import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Analytics } from "@/lib/analytics";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MilhasGrupo — Disney em família com suas milhas",
  description:
    "Avisamos quando há 3 a 6 assentos no mesmo voo para Orlando em Azul Fidelidade, LATAM Pass ou Smiles.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${instrumentSerif.variable} font-sans antialiased`}
      >
        <Analytics />
        {children}
      </body>
    </html>
  );
}
