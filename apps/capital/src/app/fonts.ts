import localFont from "next/font/local";

// Vendored (next/font/local), not next/font/google: the google variant
// downloads fonts from fonts.googleapis.com DURING `next build`, and that
// fetch flaps inside the Docker build VM — it broke several image builds in
// a row before being pinned locally. Variable latin subsets, OFL licences
// beside them in ./fonts.
//
// The variable names are the ones globals.css maps the Tailwind font
// utilities to: font-sans (Geist), font-mono (Geist Mono) and the
// font-title utility (Fraunces, with the soft axis turned on there).

/** Interface text. */
const geist = localFont({
  src: "./fonts/geist-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
  display: "swap",
  fallback: ["system-ui", "Helvetica Neue", "Arial", "sans-serif"],
});

/** Amounts, dates and anything aligned by digit. */
const geistMono = localFont({
  src: "./fonts/geist-mono-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

/** Titles and the wordmark. All axes (wght, opsz, SOFT, WONK). */
const fraunces = localFont({
  src: "./fonts/fraunces-latin-full-normal.woff2",
  weight: "100 900",
  variable: "--font-fraunces",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

/** Classes for <body>: the three font variables, the sans face, antialiasing. */
export const BODY_CLASS = `${geist.variable} ${geistMono.variable} ${fraunces.variable} font-sans antialiased`;
