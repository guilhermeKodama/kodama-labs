self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
// Pass-through deliberado: existe só para satisfazer o critério de
// instalabilidade do Chrome/Edge. Nada é cacheado — cachear respostas atrás
// do Cloudflare Access arriscaria servir a tela de login no lugar do app.
self.addEventListener("fetch", () => {});
