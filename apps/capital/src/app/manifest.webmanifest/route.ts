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
      id: "/",
      name: "Capital — gestão financeira",
      short_name: "Capital",
      description: "Finanças PJ + PF, multi-moeda, investimentos e FIRE.",
      start_url: "/dashboard",
      scope: "/",
      display: "standalone",
      background_color: "#0a0a0a",
      theme_color: "#0a0a0a",
      icons: [
        // ?v=N busts every cache layer (browser HTTP cache, Cloudflare edge)
        // at once — same-named icon files otherwise get served stale at
        // reinstall time and the launcher keeps the old artwork. Bump when
        // the artwork changes.
        { src: "/icon-192.png?v=2", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png?v=2", sizes: "512x512", type: "image/png" },
      ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
        // Same reasoning as /sw.js: this sits behind Cloudflare, and an
        // edge-cached stale manifest (wrong scope/id/icons) would be much
        // harder to notice than a stale script.
        "Cache-Control": "no-cache",
      },
    }
  );
}
