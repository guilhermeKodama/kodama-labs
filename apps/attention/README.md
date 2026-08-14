# attention — POC de entrega de notificação

Testa duas suposições antes de construir o app de curadoria de mensagens de verdade:

1. Uma PWA servida deste próprio desktop entrega push no iPhone de forma confiável e atravessa
   o Foco quando está na allowlist.
2. Uma sessão de WhatsApp não-oficial sobrevive dias sem re-QR e sem ban.

Critérios de sucesso, árvore de decisão e o protocolo completo de teste estão no plano da POC.
Este README cobre só a parte operacional: como rodar.

## 1. Configurar

```bash
cp .env.example .env
pnpm exec web-push generate-vapid-keys
```

Cole a chave pública em `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e a privada em `VAPID_PRIVATE_KEY` no
`.env`. Troque `WHATSAPP_HASH_SALT` por qualquer string secreta.

## 2. Banco local

Do root do monorepo:

```bash
pnpm db:up
pnpm --filter @wallex/attention db:migrate:dev
```

## 3. Rodar local

```bash
pnpm --filter @wallex/attention dev
```

Em `localhost:3005`, no DevTools → Application: manifest válido, service worker `activated`.
Clicar em "Ativar notificações" deve criar uma linha em `PushSubscription`.

## 4. Expor (teste de 30 min, sem domínio)

```bash
cloudflared tunnel --url http://localhost:3005
```

Abrir a URL gerada no iPhone **pelo Safari** → Compartilhar → Adicionar à Tela de Início → abrir
pelo ícone (não pelo Safari) → Ativar notificações → ir em `/lab` e clicar em "Disparar beacon
agora" → confirmar que a linha ganha `Recebido` com o telefone bloqueado, sem tocar em nada.

Ligar o Foco Sono, adicionar o app à allowlist (Ajustes → Foco → Sono → Apps → Attention),
disparar de novo → confirmar banner **com som**.

Se isso não funcionar, não vale a pena seguir para o soak — volte ao plano e reavalie a árvore
de decisão antes de continuar.

## 5. Soak de 7 dias (domínio + tunnel nomeado)

Trocar a origem depois de instalado invalida a subscription e a instalação na tela de início —
por isso o domínio precisa estar decidido antes de começar a contar os 7 dias.

```bash
cloudflared tunnel login
cloudflared tunnel create attention
cloudflared tunnel route dns attention attention.seudominio.com
cp cloudflared/config.example.yml cloudflared/config.yml
# editar cloudflared/config.yml com o tunnel id, o caminho das credenciais e o hostname
```

Reinstalar a PWA a partir do hostname definitivo (`https://attention.seudominio.com`), repetir
o passo 4 nesse domínio antes de considerar o soak iniciado.

## 6. Instalar como serviço (Linux, systemd)

```bash
sed -i "s|__REPO_PATH__|$(pwd)/../..|g; s|__USER__|$(whoami)|g" systemd/*.service
sudo cp systemd/attention-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now attention-web attention-tunnel attention-beacon
```

`attention-web` builda? Não — builde manualmente antes (e a cada `git pull`):

```bash
pnpm --filter @wallex/attention build
```

Ver `/lab` no dia 7 pra decidir.

## 7. WhatsApp

Via Baileys (WebSocket direto, sem navegador — nenhuma dependência de sistema extra):

```bash
pnpm --filter @wallex/attention worker:whatsapp
```

Escaneie o QR impresso no terminal com **WhatsApp → Aparelhos conectados** no celular (ou pelo QR
renderizado em `/lab`, quando o worker estiver rodando como serviço). A sessão fica em
`WHATSAPP_AUTH_DIR` (default fora do repo, gitignored se você optar por um caminho dentro dele —
contém acesso completo à conta, nunca commitar).

Depois de validar manualmente, subir como serviço:

```bash
systemctl --user enable --now attention-whatsapp
```

Conteúdo real das mensagens é gravado (nomes reais, corpo do texto) — corpo é purgado depois de
`RETENTION_DAYS` (default 7), metadados e scores ficam.

## Troubleshooting

- **Push não chega**: confira se a subscription não está com `deadAt` preenchido em `/lab`. Se
  sim, reabra a PWA e clique em "Ativar notificações" de novo.
- **`pnpm` não encontrado pelo systemd**: rode `which pnpm` e ajuste `ExecStart` nas units para
  o caminho absoluto.
- **WhatsApp não conecta ou desloga sozinho**: confira `journalctl --user -u attention-whatsapp -f`.
  Reconexões muito rápidas em sequência podem levar o WhatsApp a deslogar o aparelho por conta
  própria — evite reiniciar o worker repetidamente em pouco tempo. Um logout confirmado
  (`DisconnectReason.loggedOut`) já limpa a sessão automaticamente e pede um QR novo no próximo boot.
