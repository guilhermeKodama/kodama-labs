import localFont from 'next/font/local';

// The files are vendored (latin subsets from the @fontsource packages, OFL
// licences beside them) rather than loaded with next/font/google: that fetch
// happens during `next build` and is unreliable inside the Docker build.
//
// Each face sets a raw --kl-font-* variable on <html>; src/styles/theme.css
// maps the Tailwind font utilities onto them.

/** Display and text. Variable, with the optical-size axis (8-60). */
const sourceSerif = localFont({
  src: './fonts/source-serif-4-latin-opsz-normal.woff2',
  variable: '--kl-font-serif',
  weight: '200 900',
  display: 'swap',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

/** Labels, values and anything the system reports. */
const plexMono = localFont({
  src: './fonts/ibm-plex-mono-latin-400-normal.woff2',
  variable: '--kl-font-mono',
  weight: '400',
  display: 'swap',
  fallback: ['ui-monospace', 'Menlo', 'monospace'],
});

/** Text inside the drawn product screens only, so it is not preloaded. */
const schibsted = localFont({
  src: './fonts/schibsted-grotesk-latin-wght-normal.woff2',
  variable: '--kl-font-ui',
  weight: '400 900',
  display: 'swap',
  preload: false,
  fallback: ['Helvetica Neue', 'Helvetica', 'sans-serif'],
});

export const FONT_VARIABLES = `${sourceSerif.variable} ${plexMono.variable} ${schibsted.variable}`;
