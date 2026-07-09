# Retech Linear Timer

Extensão Chrome de time tracking para o Linear. Injeta botão play/pause nas issues, mostra cronômetro ao vivo e, ao pausar, registra o tempo como comentário na Activity do ticket — no padrão consumido pela extração de dados da Retech:

```
init_task: 2026-07-09 09:00:00.000000 +00:00
-end_task: 2026-07-09 12:00:00.000000 +00:00-
```

## Funcionalidades

- **Play/pause** em widget flutuante nas páginas de issue do `linear.app` (cronômetro ao vivo).
- **Comentário automático** na issue a cada pause, via API GraphQL do Linear.
- **Um timer por dev**: dar play em outra issue pausa e registra a anterior automaticamente.
- **Badge** no ícone da extensão com o tempo decorrido.
- **Lembrete de pausa**: com timer ativo, a cada N minutos (padrão 60) dispara notificação no Chrome **e** um POST no webhook do n8n — que encaminha WhatsApp via Evolution API.
- Timer sobrevive a reload, troca de aba, fechamento do navegador e sleep da máquina (o `startedAt` fica persistido; o tempo é sempre calculado por timestamp).

## Desenvolvimento

```bash
npm install
npm run build   # gera dist/
```

O formato do comentário está isolado em `src/lib/format.ts`. Não alterar sem atualizar o parser da extração.

## Como testar (load unpacked)

1. `npm run build`
2. Chrome → `chrome://extensions`
3. Ativar **Developer mode** (canto superior direito)
4. **Load unpacked** → selecionar a pasta `dist/`
5. Clicar no ícone da extensão → colar a **Linear API Key**
   (Linear → Settings → Security & access → **Personal API keys** → New key)
6. Abrir qualquer issue no `linear.app` → widget aparece no canto inferior direito → **▶**
7. Esperar um pouco → **❚❚** → comentário aparece na Activity da issue

Após mudar código: `npm run build` de novo e clicar no ícone de **reload** da extensão em `chrome://extensions`.

## Lembrete via n8n + Evolution API

Com timer ativo, a extensão faz POST no webhook configurado, a cada intervalo:

```json
{
  "event": "timer_reminder",
  "phone": "5548999999999",
  "issue": "THE-558",
  "title": "Definição sobre implementação das telas...",
  "startedAt": "2026-07-09T12:00:00.000Z",
  "elapsedMinutes": 60,
  "elapsedHuman": "1h 00m"
}
```

Workflow no n8n:

1. **Webhook node** — método POST, path ex.: `linear-timer`. Usar a URL de produção no popup da extensão.
2. **HTTP Request node** → Evolution API:
   - URL: `{EVOLUTION_URL}/message/sendText/{INSTANCIA}`
   - Header: `apikey: {SUA_KEY}`
   - Body (Evolution v2):
     ```json
     {
       "number": "{{ $json.body.phone }}",
       "text": "⏱️ Timer ativo há {{ $json.body.elapsedHuman }} na {{ $json.body.issue }}. Que tal uma pausa de 5 min?"
     }
     ```
     (Evolution v1 usa `"textMessage": { "text": "..." }` no lugar de `"text"`.)

Ao salvar o webhook no popup, o Chrome pede permissão para o host do n8n — aceitar.

> Limitação natural: o lembrete depende do Chrome aberto. Como o timer só roda com o dev trabalhando no navegador, na prática cobre o caso real.

## Publicar na Chrome Web Store

1. Criar conta em [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) — taxa única de US$ 5.
2. `npm run zip` → gera `retech-linear-timer.zip`.
3. Dashboard → **New item** → upload do zip.
4. Preencher: descrição, ícone 128px (já em `public/icons/`), screenshots (1280×800), categoria *Workflow & Planning*.
5. **Privacy**: single purpose = "time tracking em issues do Linear"; justificar permissões (`storage` = configurações, `alarms` = cronômetro/lembrete, `notifications` = lembrete de pausa, host `api.linear.app` = criar comentários).
6. **Visibility: Unlisted** — só instala quem tem o link. Ideal para uso interno do time.
7. Submeter → review costuma levar de 1 a 3 dias úteis. Atualizações: subir novo zip com `version` incrementada no `manifest.config.ts`.

Alternativa sem loja (só testes): cada dev usa load unpacked — mas sem atualização automática.

## Estrutura

```
manifest.config.ts        # manifest MV3 (CRXJS)
src/
  background.ts           # service worker: timer, badge, alarms, webhook
  content.ts              # widget play/pause injetado no linear.app (shadow DOM)
  popup/                  # configurações (API key, webhook, telefone, intervalo)
  lib/
    format.ts             # ⚠️ formato exato do comentário + helpers de tempo
    linear.ts             # cliente GraphQL (resolveIssue, commentCreate, viewer)
    storage.ts            # estado do timer + settings em chrome.storage.local
scripts/gen-icons.mjs     # gera PNGs dos ícones sem dependências
```

## Roadmap

- **v0.2**: relatório semanal (script agrega comentários via API), auto-pause configurável após X horas.
- **v0.3**: dashboard de horas por dev/projeto, OAuth do Linear no lugar de API key.
