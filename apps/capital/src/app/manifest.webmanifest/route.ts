import { NextResponse } from "next/server";
import { BRAND, ICONS, THEME_COLOR } from "@/lib/brand";

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
      name: `${BRAND} — gestão financeira`,
      short_name: BRAND,
      description: "Finanças PJ + PF, multi-moeda, investimentos e FIRE.",
      start_url: "/transactions",
      scope: "/",
      display: "standalone",
      background_color: THEME_COLOR.light,
      theme_color: THEME_COLOR.light,
      icons: [
        // New artwork gets new file names (see ICONS), so no cache layer can
        // hand an installed app the old icon under the same URL.
        { src: ICONS.app192, sizes: "192x192", type: "image/png" },
        { src: ICONS.app512, sizes: "512x512", type: "image/png" },
        { src: ICONS.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
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
