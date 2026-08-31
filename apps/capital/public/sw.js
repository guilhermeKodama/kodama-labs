self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
// Pass-through deliberado: existe só para satisfazer o critério de
// instalabilidade do Chrome/Edge. Nada é cacheado — cachear respostas atrás
// do Cloudflare Access arriscaria servir a tela de login no lugar do app.
self.addEventListener("fetch", () => {});

// v2: push notifications for reminder-mode recurring transactions.
//
// Deliberately NO fetch() calls to the API from this worker (no receipt/ack
// telemetry like apps/attention or apps/careers' service workers do) — the
// app sits behind Cloudflare Access, and a service-worker-originated fetch
// has no way to carry the Access session cookie/redirect flow, so it would
// 302 into the Access login page instead of reaching the route. Page-context
// calls (subscribing, unsubscribing) go through the browser tab instead,
// where the Access cookie is already attached.
self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let payload = { title: "Capital", body: "Nova notificação", tag: null, url: "/recurring" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  await self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag ?? undefined,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url ?? "/recurring" },
  });
}

self.addEventListener("notificationclick", (event) => {
  const { url } = event.notification.data || {};
  event.notification.close();
  event.waitUntil(focusOrOpen(url || "/recurring"));
});

async function focusOrOpen(target) {
  const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of allClients) {
    if ("focus" in client) {
      await client.focus();
      if ("navigate" in client) await client.navigate(target);
      return;
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(target);
}

// Best-effort: some browsers rotate a subscription's endpoint/keys behind
// the scenes and fire this instead of just letting it go dead. We can't
// fetch() the API from here (see comment above), so this can't re-POST the
// refreshed subscription itself — the page-context re-sync in
// use-push-subscription.ts (on every app load, if permission is already
// granted) is what actually keeps the server's copy current.
self.addEventListener("pushsubscriptionchange", () => {});
