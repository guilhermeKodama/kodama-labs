#!/usr/bin/env node
// One-time OAuth helper: prints the Google Ads refresh token.
//
//   GOOGLE_ADS_CLIENT_ID=... GOOGLE_ADS_CLIENT_SECRET=... node scripts/google-ads-auth.mjs
//
// Prereqs (see apps/pipeline/README.md):
//   - GCP project with the Google Ads API enabled
//   - OAuth consent screen PUBLISHED TO PRODUCTION (an app left "In testing"
//     expires refresh tokens after 7 days — the classic trap)
//   - OAuth Client ID type "Web application" with redirect http://localhost:5555/callback
// Sign in with the Google account that admins the MCC.
import { createServer } from "node:http";

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const PORT = 5555;
const REDIRECT = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "usage: GOOGLE_ADS_CLIENT_ID=... GOOGLE_ADS_CLIENT_SECRET=... node scripts/google-ads-auth.mjs",
  );
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent", // force a NEW refresh token even if previously granted
  });

console.log("\n1. Open this URL in the browser logged into the MCC admin account:\n");
console.log(authUrl);
console.log(`\n2. Approve — you'll be redirected to localhost:${PORT} and the token prints here.\n`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("missing code");
    return;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const body = await tokenRes.json();

  if (!body.refresh_token) {
    console.error("\nNo refresh_token in response:", JSON.stringify(body, null, 2));
    console.error(
      "If you've authorized before, revoke access at https://myaccount.google.com/permissions and retry.",
    );
    res.writeHead(500).end("no refresh token — see terminal");
    server.close();
    process.exit(1);
  }

  console.log("\n✓ GOOGLE_ADS_REFRESH_TOKEN:\n");
  console.log(body.refresh_token);
  console.log("\nSet it in Vercel env + apps/pipeline/.env and you're done.");
  res.writeHead(200, { "content-type": "text/plain" }).end("Done — check the terminal.");
  server.close();
  process.exit(0);
});

server.listen(PORT);
