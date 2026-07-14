# Retech Linear Timer

Extensão Chrome de time tracking para o Linear. Injeta botão play/pause nas issues, mostra cronômetro ao vivo e, ao pausar, registra o tempo como comentário na Activity do ticket — no padrão consumido pela extração de dados da Retech:

```
init_task: 2026-07-09 09:00:00.000000 +00:00
-end_task: 2026-07-09 12:00:00.000000 +00:00-
```

## Funcionalidades

- **Play/pause** em widget flutuante nas páginas de issue do `linear.app` (cronômetro ao vivo).
- **Comentário automático** na issue a cada pause, via API GraphQL do Linear.
- **Play/pause automático por presença** (v0.2): depois do play manual, o timer
  pausa/retoma sozinho conforme três sinais combinados —
  1. **Inatividade** (`chrome.idle`): sem teclado/mouse por N minutos (padrão 5) → pause; primeiro input → play.
  2. **Câmera** (opcional): o [agente local](agent/README.md) roda face detection + prova de vida (liveness por piscada — foto no celular/impressa não engana) + **reconhecimento facial** na webcam. Cadastrando uma foto de referência no popup, só o rosto do dev mantém o timer rodando — estranho na cadeira conta como ausente. Rosto saiu por 15s, parou de piscar por 20s ou não foi reconhecido por 10s → pause; sentou de volta, piscou e foi reconhecido → play. Rosto que reaparece após ausência precisa piscar e dar match de novo antes de contar como presente.
  3. **Aba da issue**: se nenhuma aba do Chrome tem a issue aberta → pause; reabriu → play.
  Cada segmento play→pause vira um comentário `init_task`/`-end_task` na issue (segmentos < 1 min não geram comentário, para não poluir a Activity). Tudo configurável/desligável no popup.
- **Um timer por dev**: dar play em outra issue encerra e registra a anterior automaticamente.
- **Badge** no ícone da extensão com o tempo decorrido (laranja = pausado por ausência).
- **Lembrete de pausa**: com timer rodando, a cada N minutos (padrão 60) dispara notificação no Chrome **e** um POST no webhook do n8n — que encaminha WhatsApp via Evolution API.
- Timer sobrevive a reload, troca de aba, fechamento do navegador e sleep da máquina (estado persistido; o tempo é sempre calculado por timestamp).

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
  "elapsedHuman": "1h 00m",
  "message": "⏱️ Timer ativo há 1h 00m na THE-558 — Definição sobre...\n\nQue tal uma pausa de 5 min? ☕"
}
```

`message` já vem pronto, com quebras de linha reais — o n8n só repassa.

Workflow no n8n:

1. **Webhook node** — método POST, path ex.: `linear-timer`. Usar a URL de produção no popup da extensão.
2. **HTTP Request node** → Evolution API:
   - URL: `{EVOLUTION_URL}/message/sendText/{INSTANCIA}`
   - Header: `apikey: {SUA_KEY}`
   - Body: **Using Fields Below** (não "Using JSON" — `\n` em JSON manual vai literal):
     - `number` = `{{ $json.body.phone }}`
     - `text` = `{{ $json.body.message }}`
     (Evolution v1 usa `textMessage.text` no lugar de `text`.)

Ao salvar o webhook no popup, o Chrome pede permissão para o host do n8n — aceitar.

> Limitação natural: o lembrete depende do Chrome aberto. Como o timer só roda com o dev trabalhando no navegador, na prática cobre o caso real.

## Atualizar o time sem a loja (GitHub Releases)

Push de tag `v*` dispara o GitHub Actions, que builda e anexa `retech-linear-timer.zip` numa Release:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

Cada dev (sem precisar de Node/git):

1. Baixar o zip da [última release](https://github.com/theretechlabs/retech-chromeex-linear/releases/latest)
2. Extrair **sempre na mesma pasta** (ex.: `~/linear-timer/`)
3. Primeira vez: `chrome://extensions` → Developer mode → Load unpacked → essa pasta
4. Atualizações: extrair o zip novo por cima da mesma pasta → botão ↻ da extensão

## Publicar na Chrome Web Store

1. Criar conta em [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) — taxa única de US$ 5.
2. `npm run zip` → gera `retech-linear-timer.zip`.
3. Dashboard → **New item** → upload do zip.
4. Preencher: descrição, ícone 128px (já em `public/icons/`), screenshots (1280×800), categoria *Workflow & Planning*.
5. **Privacy**: single purpose = "time tracking em issues do Linear"; justificar permissões (`storage` = configurações, `alarms` = cronômetro/lembrete, `notifications` = lembrete de pausa, `idle` = auto-pause por inatividade, `tabs` = detectar aba da issue aberta, `offscreen` = tocar aviso sonoro de pause/play, host `api.linear.app` = criar comentários).
6. **Visibility: Unlisted** — só instala quem tem o link. Ideal para uso interno do time.
7. Submeter → review costuma levar de 1 a 3 dias úteis. Atualizações: subir novo zip com `version` incrementada no `manifest.config.ts`.

Alternativa sem loja (só testes): cada dev usa load unpacked — mas sem atualização automática.

## Estrutura

```
manifest.config.ts        # manifest MV3 (CRXJS)
src/
  background.ts           # service worker: timer (run/pause), presença (idle+câmera+aba), badge, alarms, webhook
  content.ts              # widget play/pause injetado no linear.app (shadow DOM)
  popup/                  # configurações (API key, webhook, presença, intervalo)
  lib/
    format.ts             # ⚠️ formato exato do comentário + helpers de tempo
    linear.ts             # cliente GraphQL (resolveIssue, commentCreate, viewer)
    storage.ts            # estado do timer + settings em chrome.storage.local
agent/                    # agente local de presença (Python + MediaPipe + WebSocket)
scripts/gen-icons.mjs     # gera PNGs dos ícones sem dependências
```

## Play/pause automático — como funciona por dentro

- O play continua **manual** (associa o timer à issue), mas com agente ativo +
  rosto cadastrado ele só inicia **depois do reconhecimento facial**: o
  background pede um `verify` ao agente (espera até ~6s por um match fresco) e
  bloqueia com "rosto não reconhecido" se não for o dev. Retomar manual passa
  pela mesma verificação. Agente desligado/offline ou sem foto cadastrada →
  play normal (consistente com o auto-pause, que também não trava com o agente
  fora do ar). A partir daí o
  `background.ts` reavalia presença a cada evento (`chrome.idle.onStateChanged`,
  mensagens do agente, abas abertas/fechadas) e a cada minuto (alarm do badge).
- Pause automático fecha o **segmento** atual e posta o comentário
  `init_task`/`-end_task` na hora; o resume abre um segmento novo. O total
  exibido = segmentos fechados + segmento corrente.
- O agente de câmera conversa com a extensão por WebSocket em
  `ws://127.0.0.1:8998` (só loopback; nenhuma imagem sai da máquina — ver
  `agent/README.md`). Sem agente rodando, a regra da câmera simplesmente não
  se aplica (idle + aba continuam valendo).
- Motivo do pause aparece no widget e no popup: `inativo`, `ausente` (câmera),
  `rosto não reconhecido` ou `aba da issue fechada`.
- **Voz de pause/play** (opcional, toggle no popup): transições **automáticas**
  tocam `public/sounds/pause.mp3` / `resume.mp3` via offscreen document (MV3
  não toca áudio no service worker). Ações manuais são mudas; sem os mp3, o
  aviso é no-op.

## Roadmap

- **v0.3**: relatório semanal (script agrega comentários via API), dashboard de horas por dev/projeto, OAuth do Linear no lugar de API key, instalador/empacotamento do agente (PyInstaller) + autostart.
