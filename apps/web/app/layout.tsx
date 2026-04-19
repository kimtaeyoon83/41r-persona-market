import type { Metadata } from "next";
import { Inter_Tight, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import { EvmWalletProvider } from "@/components/evm-wallet-provider";

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-display-loaded",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans-loaded",
  display: "swap",
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-loaded",
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
        className={`${interTight.variable} ${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <SolanaWalletProvider>
          <EvmWalletProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <main className="flex-1 ml-[232px] min-h-screen">
                <div className="max-w-[1240px] mx-auto px-7 py-7">
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
