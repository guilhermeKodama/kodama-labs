self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  // beaconId (soak/telemetry) and notifId (digest/now/health) are mutually
  // exclusive but share this one handler — both round-trip through
  // /api/beacon/* because that's the only path with a Cloudflare Access
  // Bypass policy; a fetch to any other path would 302 into an HTML login
  // page the .catch(()=>{}) below would silently swallow.
  let payload = { title: "Attention", body: "Novo beacon", beaconId: null, notifId: null, kind: null, tag: null, badge: null, url: "/lab" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  const receiptPromise =
    payload.beaconId || payload.notifId
      ? fetch("/api/beacon/receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beaconId: payload.beaconId, notifId: payload.notifId }),
        }).catch(() => {})
      : Promise.resolve();

  const showPromise = self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag ?? payload.notifId ?? payload.beaconId ?? undefined,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { beaconId: payload.beaconId, notifId: payload.notifId, url: payload.url ?? "/lab" },
  });

  const badgePromise =
    typeof payload.badge === "number" && self.navigator.setAppBadge
      ? self.navigator.setAppBadge(payload.badge).catch(() => {})
      : Promise.resolve();

  await Promise.all([receiptPromise, showPromise, badgePromise]);
}

self.addEventListener("notificationclick", (event) => {
  const { beaconId, notifId, url } = event.notification.data || {};
  event.notification.close();
  event.waitUntil(handleClick(beaconId, notifId, url));
});

async function handleClick(beaconId, notifId, url) {
  const target = url || "/lab";

  const ackPromise =
    beaconId || notifId
      ? fetch("/api/beacon/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beaconId, notifId }),
        }).catch(() => {})
      : Promise.resolve();

  const focusPromise = (async () => {
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if ("focus" in client) {
        client.focus();
        if ("navigate" in client) client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })();

  await Promise.all([ackPromise, focusPromise]);
}
