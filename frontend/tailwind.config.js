/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "on-secondary-container": "#b1b1ff",
        "surface-bright": "#37393a",
        "background": "#080a0a",
        "tertiary-fixed": "#bee9ff",
        "on-secondary-fixed-variant": "#332dbc",
        "tertiary": "#68d3ff",
        "on-surface-variant": "#c1c6d7",
        "on-error-container": "#ffdad6",
        "secondary": "#c2c1ff",
        "primary-fixed-dim": "#adc6ff",
        "on-primary-fixed-variant": "#004493",
        "surface-variant": "#333535",
        "surface-tint": "#adc6ff",
        "on-background": "#e2e2e2",
        "surface-container": "#111414",
        "surface-container-highest": "#333535",
        "error": "#ffb4ab",
        "on-tertiary-container": "#002e3d",
        "surface-container-low": "#1a1c1c",
        "on-primary": "#002e69",
        "outline-variant": "#414755",
        "on-tertiary-fixed": "#001f2a",
        "on-error": "#690005",
        "secondary-container": "#3630bf",
        "surface-dim": "#121414",
        "surface": "#121414",
        "surface-container-lowest": "#060808",
        "on-primary-container": "#00285c",
        "outline": "#8b90a0",
        "on-secondary": "#1800a7",
        "primary-container": "#4b8eff",
        "on-primary-fixed": "#001a41",
        "inverse-on-surface": "#2f3131",
        "surface-container-high": "#282a2b",
        "secondary-fixed": "#e2dfff",
        "on-tertiary": "#003546",
        "primary": "#adc6ff",
        "error-container": "#93000a",
        "inverse-surface": "#e2e2e2",
        "tertiary-fixed-dim": "#68d3ff",
        "on-surface": "#e2e2e2",
        "on-secondary-fixed": "#0c006b",
        "primary-fixed": "#d8e2ff",
        "secondary-fixed-dim": "#c2c1ff",
        "tertiary-container": "#139cc7",
        "inverse-primary": "#005bc1",
        "on-tertiary-fixed-variant": "#004d64"
      },
      borderRadius: {
        "DEFAULT": "1rem",
        "lg": "2rem",
        "xl": "3rem",
        "full": "9999px"
      },
      spacing: {
        "gutter": "24px",
        "stack-gap": "16px",
        "container-padding-desktop": "40px",
        "container-padding-mobile": "20px",
        "unit": "8px"
      },
      fontFamily: {
        "body-lg": ["Inter", "sans-serif"],
        "display-lg-mobile": ["Inter", "sans-serif"],
        "display-lg": ["Inter", "sans-serif"],
        "headline-md": ["Inter", "sans-serif"],
        "body-md": ["Inter", "sans-serif"],
        "label-sm": ["Inter", "sans-serif"]
      },
      fontSize: {
        "body-lg": ["18px", {"lineHeight": "28px", "fontWeight": "400"}],
        "display-lg-mobile": ["32px", {"lineHeight": "40px", "letterSpacing": "-0.02em", "fontWeight": "700"}],
        "display-lg": ["48px", {"lineHeight": "56px", "letterSpacing": "-0.02em", "fontWeight": "700"}],
        "headline-md": ["24px", {"lineHeight": "32px", "letterSpacing": "-0.01em", "fontWeight": "600"}],
        "body-md": ["16px", {"lineHeight": "24px", "fontWeight": "400"}],
        "label-sm": ["12px", {"lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "600"}]
      }
    }
  },
  plugins: [
    require('@tailwindcss/container-queries'),
    require('@tailwindcss/forms'),
  ],
}
