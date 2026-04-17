import type { Metadata } from "next";
import { Syne, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import { EvmWalletProvider } from "@/components/evm-wallet-provider";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "41R Persona Market",
  description: "AI Persona-Based Product Validation Marketplace on Solana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${syne.variable} ${dmSans.variable} ${jetbrainsMono.variable} font-sans antialiased bg-surface-base text-[var(--text-primary)]`}
      >
        <SolanaWalletProvider>
          <EvmWalletProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <main className="flex-1 ml-[260px] min-h-screen">
                <div className="max-w-[1200px] mx-auto px-8 py-8">
                  {children}
                </div>
              </main>
            </div>
          </EvmWalletProvider>
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
