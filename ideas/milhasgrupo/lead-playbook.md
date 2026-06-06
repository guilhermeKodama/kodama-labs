# MilhasGrupo — Playbook de Lead

Mensagens padrão pós-cadastro no **Telegram** (preferido) ou **WhatsApp**.

Alinhado a [validation.md](validation.md) (§4–§5) e ao runbook em [README.md](README.md) §3.

Coluna **`status`** na planilha: use exatamente os valores abaixo (case-sensitive).

---

## Status dos leads

| Status | Significado | Quando setar |
| --- | --- | --- |
| *(vazio)* | Cadastro acabou de cair na planilha | Automático no webhook; ainda sem contato |
| `Lead` | Na fila de onboarding | Ao revisar a linha; ou mantenha vazio até enviar msg0 |
| `Onboarding` | Mensagem 0 enviada, aguardando as 3 respostas | Logo após enviar a Mensagem 0 |
| `Qualified` | Origem, programas e saldo confirmados | Quando o lead responder às 3 perguntas (resumo em `notes`) |
| `Active` | Recebeu pelo menos 1 alerta de voo | Ao enviar o primeiro alerta útil (README §3) |
| `Issued` | Emitiu pelo menos 1 assento | Quando confirmar emissão (`issuances` ≥ 1) |
| `Cold` | Parado 7+ dias após msg0, sem resposta | Após reengajamento sem retorno (README §3) |
| `Lost` | Fora do beta / desistiu / fora de escopo | Não vai seguir (ex.: destino ≠ MCO, grupo menor que 3) |

### Transições

```text
(vazio) → Lead → Onboarding → Qualified → Active → Issued
                ↘ Cold          ↘ Lost
         Lost (fora de escopo a qualquer momento)
```

- **Não** pule para `Active` sem passar por `Qualified` (senão você alerta sem origem/programas/saldo).
- **Não** marque `Issued` só por “vou tentar emitir” — só com confirmação real; preencha `issuances`.
- `Active` com `issuances` = 0 após follow-up: mantenha `Active` (pode mandar mais alertas). Só vá para `Issued` quando houver assento emitido.

### Funil (validation.md §5)

| Métrica | Quem entra na conta |
| --- | --- |
| **Lead** (estágio) | `status` vazio, `Lead`, `Onboarding`, `Qualified`, `Cold` |
| **Active** (estágio) | `Active`, `Issued` |
| **Issuance** | coluna `issuances` ≥ 1 |

Fórmulas no README §4: `Lead → Active` = linhas `Active` ou `Issued` / total com e-mail.

---

## Fluxo

1. Formulário → planilha (`status` vazio)
2. Revisar → `Lead` → **Mensagem 0** em até 24h → `Onboarding`
3. Resposta às 3 perguntas → `notes` + `Qualified`
4. Buscar N assentos (Azul / LATAM / Smiles, GRU/CNF/VCP → MCO)
5. **Mensagem 1** (alerta) → `Active`, `alerts_sent` +1
6. Emissão confirmada → `Issued`, `issuances` preenchido

---

## Quando enviar

| Situação | Ação |
| --- | --- |
| `status` vazio ou `Lead` | Mensagem 0 → `Onboarding` |
| `Onboarding` | Aguardar 3 respostas; se 7+ dias sem resposta → reengajar → `Cold` ou `Lost` |
| `Qualified` | Buscar voos → alerta (README §3) → `Active` |
| `Active` | Follow-up 24–48h; se emitiu → `Issued` |

---

## O que o formulário já traz

| Coluna | Uso na Mensagem 0 |
| --- | --- |
| `contact` | Canal de envio |
| `group_size` | “vocês 4”, “família de 5”, etc. |
| `travel_window` | Frase opcional sobre prazo (tabela abaixo) |
| `email` | Só uso interno |

O form **não** pede: nome, origem, programas, saldo de milhas → a Mensagem 0 coleta isso.

**Nome:** use o do perfil Telegram/WhatsApp, ou comece com “Oi!” até saber.

### `travel_window` (opcional, 1 frase)

| Valor | Texto |
| --- | --- |
| `0-6m` | nos próximos 6 meses |
| `6-12m` | em 6 a 12 meses |
| `12-18m` | em 12 a 18 meses |
| `researching` | ainda pesquisando datas |

### `group_size`

| Valor | Na mensagem | Na busca |
| --- | --- | --- |
| `3` | vocês 3 | 3 assentos |
| `4` | vocês 4 | 4 assentos |
| `5` | vocês 5 | 5 assentos |
| `6+` | 6 ou mais | 6 assentos (confirmar na conversa se preciso) |

---

## Mensagem 0 — padrão (copiar e colar)

Substitua `[NOME]` e `[N]` (`[N]` = `group_size` da planilha).

**Template:**

```text
Oi [NOME]! Aqui é da MilhasGrupo 🙌 Vi seu cadastro pra Orlando com a família. Já vou começar a cruzar Azul, LATAM e Smiles pra achar [N] assentos no mesmo voo — mas pra eu não te trazer opção que não dá pra emitir, preciso de 3 coisas rapidinho:

1. Vocês saem de São Paulo, Belo Horizonte ou Campinas?
2. As milhas estão em qual programa? Azul (TudoAzul), LATAM Pass ou Smiles — pode ser mais de um.
3. Mais ou menos quantas milhas/pontos vocês têm em cada um? (não precisa ser exato, só a faixa)

Com isso eu já vejo o que faz sentido de verdade pra vocês e te aviso assim que tiver assento. 👇
```

**Exemplo preenchido** (`group_size` = 4):

```text
Oi Camila! Aqui é da MilhasGrupo 🙌 Vi seu cadastro pra Orlando com a família (vocês 4). Já vou começar a cruzar Azul, LATAM e Smiles pra achar 4 assentos no mesmo voo — mas pra eu não te trazer opção que não dá pra emitir, preciso de 3 coisas rapidinho:

1. Vocês saem de São Paulo, Belo Horizonte ou Campinas?
2. As milhas estão em qual programa? Azul (TudoAzul), LATAM Pass ou Smiles — pode ser mais de um.
3. Mais ou menos quantas milhas/pontos vocês têm em cada um? (não precisa ser exato, só a faixa)

Com isso eu já vejo o que faz sentido de verdade pra vocês e te aviso assim que tiver assento. 👇
```

Ao enviar: `status` → `Onboarding` e em `notes`: `[AAAA-MM-DD] msg0 enviada`.

---

## Depois da resposta

1. Colar a resposta integral em `notes` (texto do lead = sinal de validação).
2. Resumo no fim de `notes`, por exemplo:  
   `[2026-06-04] origem=GRU | programas=Smiles,LATAM | saldo=~400k Smiles, ~200k LATAM`
3. `status` → `Qualified`
4. Buscar disponibilidade só com origem/programas/saldo confirmados.
5. Primeiro alerta → README §3: `status` → `Active`, `alerts_sent` +1.
6. Emissão confirmada → `status` → `Issued`, `issuances` = número de assentos.

---

## Checklist por lead

- [ ] `status`: vazio → `Lead`
- [ ] Mensagem 0 em `contact` → `Onboarding` + `notes`: `[data] msg0 enviada`
- [ ] Resposta às 3 perguntas → `Qualified` + resumo em `notes`
- [ ] Busca com N assentos no mesmo voo
- [ ] Alerta → `Active`, `alerts_sent` +1
- [ ] Follow-up 24–48h → `issuances` + resposta em `notes`
- [ ] Emitiu → `Issued` (ou permanece `Active` se não emitiu)

---

## Outras mensagens

| Etapa | Onde |
| --- | --- |
| Alerta com link | [README.md](README.md) §3 — Alert template |
| “Deu pra emitir?” | README §3 — Follow-up 24–48h |
| Lead frio 7+ dias | README §3 — Weekly check-in |
