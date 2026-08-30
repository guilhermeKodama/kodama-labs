import { NextResponse } from "next/server";

// Not app/manifest.ts (the file-convention route) on purpose: that convention's
// auto-injected <link rel="manifest"> has no way to set crossOrigin, and
// browsers fetch the manifest without credentials by default — behind
// Cloudflare Access, that request has no session cookie, gets redirected to
// the Access login page, and the cross-origin redirect then fails CORS. The
// manual <link crossOrigin="use-credentials"> in layout.tsx needs a manually
// served endpoint to point at.
export function GET() {
  return NextResponse.json(
    {
      name: "Capital — gestão financeira",
      short_name: "Capital",
      description: "Finanças PJ + PF, multi-moeda, investimentos e FIRE.",
      start_url: "/dashboard",
      display: "standalone",
      background_color: "#0a0a0a",
      theme_color: "#0a0a0a",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } }
  );
}
