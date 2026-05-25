import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Analytics } from "@/lib/analytics";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MilhasGrupo — Orlando em família com suas milhas",
  description:
    "Para famílias brasileiras com filhos: encontramos 3 a 6 assentos no mesmo voo para Orlando em Azul, LATAM e Smiles. Você cadastra a viagem, a gente avisa quando dá.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Analytics />
        {children}
      </body>
    </html>
  );
}
