import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-plex-mono" });

// Every page is rendered per request, so each one carries the CSP nonce from middleware.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PrintKiosk Painel",
  description: "Assinaturas, códigos de ativação, cópias e faturamento dos quiosques PrintKiosk.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
