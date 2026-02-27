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
        // Solana brand
        sol: {
          green: "#14F195",
          purple: "#9945FF",
          blue: "#00C2FF",
        },
        // Surface colors
        surface: {
          base: "#000000",
          DEFAULT: "#0E1019",
          elevated: "#151822",
          card: "#1A1E2B",
          "card-hover": "#1F2435",
        },
        // Border colors
        border: {
          dim: "#1E2230",
          DEFAULT: "#282D3E",
          hover: "#3A3F52",
        },
      },
      fontFamily: {
        display: ["Syne", "system-ui", "sans-serif"],
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "monospace"],
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
