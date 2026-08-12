# Handoff — attention POC

Para quem (humano ou agente) for continuar este trabalho numa máquina onde a conversa original
não existe. Este documento é o "porquê" e o "e agora"; o [README.md](README.md) é o "como rodar".

## O produto por trás desta POC

O objetivo final (fora do escopo deste app) é um app de curadoria de mensagens: conecta Gmail,
WhatsApp e Instagram, resume o que precisa de resposta, sugere a resposta, e — se autorizado —
envia sozinho. O requisito que motivou tudo: precisa conseguir notificar "à força", furando
qualquer Não Perturbe, tanto no Mac quanto no iPhone.

Esse produto completo depende de duas suposições que ninguém tinha testado. Construir a
curadoria, o LLM e o envio de resposta antes de validar essas duas seria construir em cima de
areia — por isso esta POC existe primeiro, isolada, e não deveria virar a base do app real até
resolver.

## As duas suposições em jogo

1. **Entrega**: uma PWA auto-hospedada notifica o iPhone de forma confiável e atravessa o Foco
   quando está na allowlist de notificações do app (Ajustes → Foco → Apps).
2. **WhatsApp**: uma sessão de cliente não-oficial (`whatsapp-web.js`) sobrevive dias sem re-QR
   e sem levar ban.

Se (1) falhar, o produto inteiro muda de forma (app iOS nativo com Time Sensitive/Critical
Alerts, US$99/ano de conta Apple Developer). Se (2) falhar, o canal mais importante do produto
some e é preciso reavaliar (Baileys, bridge Matrix, ou tirar WhatsApp do escopo).

## Decisões já tomadas, e por quê

| Decisão | Alternativa descartada | Por quê |
|---|---|---|
| Servidor = desktop Linux, sempre ligado | Vercel/serverless | IMAP IDLE e a sessão do WhatsApp precisam de socket vivo 24/7; serverless não serve |
| Exposição = Cloudflare Tunnel | Tailscale | O Mac do trabalho do usuário **bloqueia instalação de VPN** — Cloudflare Tunnel expõe um hostname HTTPS comum, sem cliente instalado |
| `whatsapp-web.js` (Puppeteer) | Baileys | Roda o cliente web oficial por dentro (injeta nos módulos internos), fingerprint de protocolo menor que uma reimplementação. Com um desktop dedicado, o custo de ~1GB de RAM do Chromium deixou de ser um problema |
| PWA em vez de app nativo, primeiro | App iOS nativo direto | PWA cobre os três dispositivos com um código só; iOS permite marcar a PWA como exceção de Foco pela allowlist, o que pode já resolver o furo de DND sem custo nenhum |
| Metadados hasheados no WhatsApp, nunca corpo | Guardar a mensagem completa | A trilha B só precisa provar sobrevivência de sessão + virar dado de bootstrap pro score de reciprocidade — não precisa (e não deveria, antes de existir auth) reter conteúdo pessoal |
| Sem auth nas rotas por enquanto | Auth desde o início | Só trafegam beacons sintéticos e metadados hasheados. **Cloudflare Access entra antes de qualquer conteúdo real de mensagem tocar o app** — isso é um bloqueador para expandir o escopo, não um detalhe |

Decisões de produto mais amplas (fora do escopo desta POC, mas que vão importar quando o app
real for construído): a interface principal é a notificação, não o app; a fila de triagem
precisa conseguir chegar a zero; toda resposta automática usa janela de desfazer (~45s), nunca
diálogo de confirmação; auto-envio é conquistado por padrão de uso repetido, não configurado de
uma vez; e falsos negativos do filtro se auto-rotulam observando as mensagens que o próprio
usuário responde fora do digest.

## Estado atual

Construído e verificado neste Mac (install, migração, typecheck, lint, build de produção, e um
smoke test end-to-end via curl: subscribe → grava no Postgres → `/lab` reflete o dado):

- PWA completa: manifest, ícones (192/512/apple-touch-icon 180), service worker com telemetria
  (recibo automático no `push`, confirmação no `notificationclick`)
- Rotas `/api/push/subscribe`, `/api/beacon/receipt`, `/api/beacon/ack`
- `/lab` — dashboard com estatísticas de entrega, latência p50/p95, recorte por janela de Foco,
  subscriptions mortas, disparo manual de beacon
- `worker/beacon.ts` — dispara a cada 30 min para toda subscription viva
- `worker/whatsapp.ts` — captura metadados via `message_create` (inclui mensagens enviadas pelo
  próprio usuário, necessário para `direction: OUT`)
- Units systemd (web, tunnel, beacon, whatsapp) + `cloudflared/config.example.yml`
- Banco `attention` já migrado localmente (schema: `PushSubscription`, `Beacon`, `FocusWindow`,
  `WhatsAppMessageMeta`)

**Não verificado ainda — e é justamente isso que a POC existe para responder:**
- Push chegando de fato num iPhone real
- Se a allowlist do Foco realmente deixa passar
- Se a sessão do WhatsApp sobrevive dias sem cair

## Próximo passo imediato

O teste de 30 minutos descrito na seção 4 do [README.md](README.md): expor com
`cloudflared tunnel --url`, instalar a PWA no iPhone pela Tela de Início, ativar notificações,
disparar um beacon manual em `/lab` com o telefone bloqueado, depois repetir com o Foco Sono
ligado e o app na allowlist.

**Esse teste é o gate.** Se a PWA não furar o Foco nesse teste rápido, não vale a pena começar a
contar os 7 dias de soak sem antes reavaliar — ver a árvore de decisão abaixo.

## Depois do teste de 30 min: soak de 7 dias

Domínio + tunnel nomeado primeiro (seção 5 do README — trocar de origem depois de instalado
invalida a subscription e a instalação na tela de início). Depois, instalar como serviço
(seção 6) e o worker de WhatsApp em paralelo (seção 7). Ler `/lab` no dia 7.

### Critérios de sucesso

**Notificação**: entrega ≥ 98% em 7 dias; 100% dos beacons durante Foco com allowlist chegam com
banner e som; latência p95 < 30s; subscription sobrevive 7 dias e a um reinício do telefone.

**WhatsApp**: sessão sobrevive 7 dias sem re-QR; sem ban; contagem bate com conferência manual;
reconecta sozinho após queda de rede.

### Árvore de decisão

| Resultado | Consequência |
|---|---|
| Tudo passa | PWA-only. Pushover fica só como degrau 2 opcional |
| Foco não fura | PWA pro digest, Pushover pro urgente |
| Entrega < 95% ou subscription morre | PWA vira só UI; Pushover assume como canal primário |
| Foco não fura **e** entrega ruim | App iOS nativo antecipado (US$99/ano) |
| Trilha B falha | Reavaliar: Baileys, bridge Matrix, ou WhatsApp fora do escopo |

## Onde está cada coisa

- **Como rodar, instalar, expor**: [README.md](README.md)
- **Por que essas decisões, o que fazer com o resultado**: este arquivo
- **Modelo de dados**: [prisma/schema.prisma](prisma/schema.prisma)
- **Lógica de disparo de beacon** (reusada pelo worker e pelo botão manual do `/lab`):
  [src/server/lib/dispatch-beacon.ts](src/server/lib/dispatch-beacon.ts)
