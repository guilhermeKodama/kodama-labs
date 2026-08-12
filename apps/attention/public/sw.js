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
  let payload = { title: "Attention", body: "Novo beacon", beaconId: null, url: "/lab" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  const receiptPromise = payload.beaconId
    ? fetch("/api/beacon/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beaconId: payload.beaconId }),
      }).catch(() => {})
    : Promise.resolve();

  const showPromise = self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.beaconId ?? undefined,
    data: { beaconId: payload.beaconId, url: payload.url ?? "/lab" },
  });

  await Promise.all([receiptPromise, showPromise]);
}

self.addEventListener("notificationclick", (event) => {
  const { beaconId, url } = event.notification.data || {};
  event.notification.close();
  event.waitUntil(handleClick(beaconId, url));
});

async function handleClick(beaconId, url) {
  const target = url || "/lab";

  const ackPromise = beaconId
    ? fetch("/api/beacon/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beaconId }),
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
