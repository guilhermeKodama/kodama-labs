import localFont from "next/font/local";

// Vendored (next/font/local), not next/font/google: the google variant
// downloads fonts from fonts.googleapis.com DURING `next build`, and that
// fetch flaps inside the Docker build VM — it broke several image builds in
// a row before being pinned locally. Variable-weight latin woff2s, ~64KB.
const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk-latin-var.woff2",
  weight: "300 700",
  variable: "--font-sans",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-var.woff2",
  weight: "100 800",
  variable: "--font-mono",
});

/** Classes for <body>: both font variables, the sans face, antialiasing. */
export const BODY_CLASS = `${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased`;
