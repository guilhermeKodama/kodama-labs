// The document (<html lang>, <body>) lives in [locale]/layout.tsx so that the
// language attribute follows the URL. This root layout only passes through.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
