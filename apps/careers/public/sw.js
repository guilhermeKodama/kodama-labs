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
  let payload = { title: "Careers", body: "Nova atualização", notifId: null, kind: null, tag: null, badge: null, url: "/" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  const receiptPromise = payload.notifId
    ? fetch("/api/push/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifId: payload.notifId }),
      }).catch(() => {})
    : Promise.resolve();

  const showPromise = self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag ?? payload.notifId ?? undefined,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { notifId: payload.notifId, url: payload.url ?? "/" },
  });

  const badgePromise =
    typeof payload.badge === "number" && self.navigator.setAppBadge
      ? self.navigator.setAppBadge(payload.badge).catch(() => {})
      : Promise.resolve();

  await Promise.all([receiptPromise, showPromise, badgePromise]);
}

self.addEventListener("notificationclick", (event) => {
  const { notifId, url } = event.notification.data || {};
  event.notification.close();
  event.waitUntil(handleClick(notifId, url));
});

async function handleClick(notifId, url) {
  const target = url || "/";

  const ackPromise = notifId
    ? fetch("/api/push/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifId }),
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
