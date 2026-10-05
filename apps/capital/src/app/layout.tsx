// The document (<html lang>, fonts, providers) is in [locale]/layout.tsx,
// which knows the active language. This root layout only exists because
// app/not-found.tsx needs one; it passes its children through.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
