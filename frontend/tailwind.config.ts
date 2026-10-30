import type { Config } from "tailwindcss";

// Deezer-style dark theme: near-black surfaces with a vivid purple accent.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0c0c11",
        panel: "#111117",
        card: "#17171f",
        raised: "#22222d",
        line: "#2f2f3d",
        fg: "#f4f2fa",
        dim: "#b4afc6",
        mute: "#706b86",
        accent: "#a238ff",
        cyan: "#6fd6ff",
        ok: "#3ddc97",
        warn: "#ff9e64",
        gold: "#ffc857",
        bad: "#ff5c7a",
        violet: "#d08cff",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: { slideUp: "slideUp .18s ease-out" },
    },
  },
  plugins: [],
};

export default config;
