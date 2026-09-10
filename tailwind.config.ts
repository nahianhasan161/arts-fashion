import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#091523",
          container: "#1e2a38",
        },
        "on-primary": "#ffffff",
        "on-primary-container": "#8591a2",
        "accent-gold": {
          DEFAULT: "#C89B3C",
          soft: "#FDF8ED",
        },
        secondary: {
          DEFAULT: "#7b5900",
          container: "#fcca66",
          fixed: "#ffdea4",
        },
        "badge-discount": "#E53E3E",
        "badge-new": "#1E2A38",
        surface: {
          DEFAULT: "#fcf9f8",
          card: "#FFFFFF",
          subtle: "#F6F7F9",
          dim: "#dcd9d9",
          container: "#f0eded",
          "container-low": "#f6f3f2",
          "container-high": "#eae7e7",
          "container-highest": "#e5e2e1",
        },
        "border-light": "#E5E7EB",
        "text-muted": "#6B7280",
        "bdt-symbol": "#333333",
        "on-surface": "#1b1c1c",
        "on-surface-variant": "#44474c",
      },
      fontFamily: {
        display: ["var(--font-oswald)", "sans-serif"],
        body: ["var(--font-plus-jakarta)", "sans-serif"],
      },
      maxWidth: {
        "container-max": "1280px",
      },
      spacing: {
        "space-2xs": "0.125rem",
        "space-xs": "0.25rem",
        "space-sm": "0.5rem",
        "space-md": "0.75rem",
        "space-base": "1rem",
        "space-lg": "1.5rem",
        "space-xl": "2rem",
        "space-2xl": "3rem",
        "space-3xl": "4.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
