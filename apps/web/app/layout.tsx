import type { Metadata, Viewport } from "next";
import { Inter_Tight, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Providers } from "./providers";

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
  title: "Project RPM",
  description: "Find Your Product-Market Fit by AI Persona",
  // Favicon: rely on Next.js auto-detection of `app/favicon.ico`
  // (multi-size 16/32/48/64/128/256 PNG-payload ICO, generated from
  // `public/favicon.png` via sips + a Buffer-built ICO header). Do
  // NOT add extra <link rel="icon"> PNG entries via metadata.icons —
  // a `sizes="any"` hint on a 500×500 vertical-wordmark PNG wins the
  // 16×16 tab slot in Chrome and downscales to an illegible black
  // bar. Apple touch icon stays on the vertical logo because iOS
  // home-screen renders large enough for the wordmark to read.
  icons: {
    apple: "/logo/rpm_black_vertical.png",
  },
};

// Without this Next 14 ships no viewport meta, so mobile Safari/Chrome
// fall back to the 980px desktop viewport and the Privy login modal
// renders at desktop size while the page is zoomed out — looks broken.
// `width=device-width, initial-scale=1` is the standard fix; we keep
// `viewportFit=cover` so the iOS notch / home-indicator zone doesn't
// crop the layout.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
