import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Solana brand — kept as product identity
        sol: {
          green: "#14F195",
          purple: "#9945FF",
          blue: "#00C2FF",
        },
        // Surface colors — now route through Hi-Fi OKLCH tokens in globals.css
        surface: {
          base: "var(--bg-0)",
          DEFAULT: "var(--bg-1)",
          elevated: "var(--bg-2)",
          card: "var(--bg-2)",
          "card-hover": "var(--bg-3)",
        },
        // Border colors — Hi-Fi hairline scale
        border: {
          dim: "var(--line-1)",
          DEFAULT: "var(--line-1)",
          hover: "var(--line-2)",
        },
      },
      fontFamily: {
        display: ["var(--font-display-loaded)", "Inter Tight", "system-ui", "sans-serif"],
        sans: ["var(--font-sans-loaded)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono-loaded)", "JetBrains Mono", "Menlo", "monospace"],
      },
      animation: {
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
      },
      keyframes: {
        "glow-pulse": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
