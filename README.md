# Retech Linear Timer

Extensão Chrome que cronometra seu trabalho nas issues do Linear e registra o tempo automaticamente como comentário no ticket. Você dá o play; pausar, retomar e registrar é por conta dela.

---

## 🚀 Comece aqui (5 minutos)

**1. Instale a extensão**

1. Baixe o `retech-linear-timer.zip` da [última release](https://github.com/theretechlabs/retech-chromeex-linear/releases/latest)
2. Extraia **sempre na mesma pasta** (ex.: `~/linear-timer/`)
3. Chrome → `chrome://extensions` → ative **Developer mode** (canto superior direito)
4. **Load unpacked** → selecione a pasta extraída

**2. Conecte ao Linear**

1. No Linear: **Settings → Security & access → Personal API keys → New key**
2. Clique no ícone da extensão → cole a key → **Salvar**

**3. Use**

1. Abra qualquer issue no `linear.app` → aparece um widget flutuante no canto da tela
2. **▶** inicia o timer · **❚❚** encerra e registra o tempo na issue
3. Pronto. O tempo aparece como comentário na Activity do ticket.

> Para atualizar depois, veja [🔄 Atualizando](#-atualizando-extensão-e-agente).

> ⚠️ **Atualizando da v0.2 ou anterior?** Nesta versão o ID interno da extensão mudou — o Chrome trata como extensão nova e **as configurações resetam**. Recoloque a API key e reenvie a foto de referência (uma vez só).

---

## ⏯️ O que acontece sozinho

Depois do seu play, o timer **pausa e retoma sem você fazer nada**:

| Situação | O que acontece |
|---|---|
| Ficou 5 min sem teclado/mouse | ⏸ pausa · volta no primeiro input |
| Fechou a aba da issue — ou navegou pra **outra tela do Linear** na mesma aba | ⏸ pausa ("aba da issue fechada") · voltou pra issue → ▶ retoma |
| Saiu da frente da câmera (com agente) | ⏸ pausa · sentou e piscou → ▶ retoma |
| Outra pessoa sentou no seu lugar | ⏸ continua pausado ("rosto não reconhecido") |
| Play em outra issue | encerra e registra a anterior automaticamente |

- **Dica:** a regra da aba é rígida — consultar o board ou outra issue (trabalho legítimo) também pausa. Com o **reconhecimento facial ativo, recomendamos desmarcar "Exigir aba da issue"** no popup: a câmera já garante que é você trabalhando, e a aba só precisa existir pra dar o play.
- Os três sinais respondem perguntas diferentes: **inatividade** = "tem alguém na máquina?" (teclado/mouse do sistema — programar no VSCode conta) · **câmera** = "é você?" · **aba** = "ainda está nessa tarefa?".
- Foco não importa: Chrome minimizado, você no editor — tudo continua funcionando (a câmera é um processo próprio e a aba só precisa **existir**, não estar focada).
- O motivo do pause aparece no widget: `inativo`, `ausente`, `aba da issue fechada`, `rosto não reconhecido`, `pisque para a câmera 👁`.
- **Voz** avisa quando pausa/retoma automaticamente (dá pra desligar no popup).
- Segmentos menores que 1 minuto não geram comentário (não polui a Activity).
- **Parciais no widget:** o numerozinho ao lado do cronômetro fica **verde** quando o total é composto por segmentos anteriores (houve pause/play). Passe o mouse (ou clique pra fixar) e veja cada parcial: horário, duração e motivo do pause. Apagado = tempo contínuo, sem nenhuma pausa.
- O timer sobrevive a reload, troca de aba, fechar o navegador e sleep da máquina.
- Badge no ícone mostra o tempo decorrido (laranja = pausado).

Tudo configurável no popup da extensão (minutos de inatividade, exigir aba aberta, som etc.).

---

## 📷 Reconhecimento facial (opcional, recomendado)

Com o agente de câmera instalado, **só o seu rosto mantém o timer** — e o play manual também exige reconhecimento antes de iniciar. Sem foto cadastrada o play **nem inicia** ("Cadastre seu rosto no popup"). O Chrome liga e desliga o agente sozinho: **a câmera só fica acesa enquanto um timer roda**.

**1. Instale o agente** (uma vez; precisa de Python 3.10+):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/theretechlabs/retech-chromeex-linear/main/scripts/install-agent.sh | bash

# Windows (PowerShell)
iwr -useb https://raw.githubusercontent.com/theretechlabs/retech-chromeex-linear/main/scripts/install-agent.ps1 | iex
```

Depois reinicie o Chrome. Na primeira execução o sistema pede permissão de câmera — aceite.

**2. Ative na extensão**: popup → marque **"Usar agente de câmera"** → Salvar → **"Testar conexão"**.

**2b. Escolha o "Setup da mesa"** (popup, cards com desenho): diz ao agente quanto tempo a câmera pode não ver seu rosto antes de pausar — calibrado pro seu layout físico:

| Perfil | Sem rosto até pausar | Pra quem |
|---|---|---|
| **Frontal** | 15s | monitor único, câmera de frente (mais rígido) |
| **Laterais** | 45s | monitores dos lados, notebook/câmera no centro |
| **Câmera de lado** | 90s | monitor principal longe da câmera (rosto quase sempre de lado) |
| **Personalizado** | manual | ajuste fino dos três parâmetros |

A segurança **não** escala com o perfil: piscada na entrada e na volta de ausência, reconhecimento a cada 1s e inatividade de 5min valem em todos. A troca de perfil aplica na hora, mesmo com o timer rodando.

**3. Cadastre seu rosto**: popup → **"Enviar foto de referência"** → escolha uma foto frontal, bem iluminada, só você nela.

Privacidade: tudo roda 100% local. Nenhuma imagem sai da máquina nem fica em disco — a foto vira um código numérico irreversível (embedding) e é descartada. O LED da câmera aceso = timer rodando. Para remover: rode o script com `--uninstall`. Modo manual/debug (WebSocket) continua existindo: [agent/README.md](agent/README.md).

---

## 🔄 Atualizando (extensão e agente)

São **duas peças** com update separado — as release notes sempre dizem, na seção "⚠️ Upgrade", qual delas mudou:

**Extensão** (toda release):
1. Baixe o `retech-linear-timer.zip` da [última release](https://github.com/theretechlabs/retech-chromeex-linear/releases/latest)
2. Extraia **por cima da mesma pasta** de sempre
3. `chrome://extensions` → clique no **↻** da Retech Linear Timer

**Agente de câmera** (só quando a release tocar em `agent/`):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/theretechlabs/retech-chromeex-linear/main/scripts/install-agent.sh | bash

# Windows (PowerShell)
iwr -useb https://raw.githubusercontent.com/theretechlabs/retech-chromeex-linear/main/scripts/install-agent.ps1 | iex
```

Depois **reinicie o Chrome**. O instalador é idempotente — rodar de novo sem precisar não quebra nada.

**Como saber se o seu agente está desatualizado** (v0.7.0+): a extensão compara sozinha a versão que o agente reporta com a mínima que ela espera.

- **Popup → status do agente**: com tudo certo aparece `Agente nativo rodando · vX.Y.Z`; com agente antigo o status fica **vermelho** com `Agente desatualizado (vX — extensão espera ≥ vY)` e o comando do instalador já aparece embaixo.
- **Popup → "Testar conexão"**: o resultado traz a versão (`✓ Agente respondeu (nativo) · v0.7.0 …`) ou o aviso `⚠ … desatualizado`.
- A checagem só acontece com o agente **conectado** (timer rodando ou logo após o "Testar conexão") — o popup não liga a câmera só pra conferir versão.
- Importante: a versão do agente **não precisa ser igual** à da extensão — releases que só mexem na extensão não exigem agente novo. O alerta só dispara quando o agente está **abaixo do mínimo** que a extensão instalada exige.

## 🔧 Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| Widget mostra "pisque para a câmera 👁" | O agente está esperando sua piscada pra confirmar que é você (e não uma foto). Só acontece no play ou quando seu rosto volta à câmera após sumir — trabalhando direto (lendo, olhando o outro monitor) não precisa ficar piscando. Pisque olhando pra câmera — retoma em ~1–3s. |
| Timer pausa quando trabalho no monitor do lado | Escolha o **"Setup da mesa"** certo no popup (Laterais ou Câmera de lado) — aumenta a tolerância de ausência da câmera pro seu layout. Persistindo, o ideal é webcam externa centralizada entre os monitores. |
| "Rosto não reconhecido" sendo você | Óculos/iluminação diferente da foto cadastrada. Reenvie uma foto nas condições da sua mesa, ou rode o agente com `--recognition-threshold 0.30` (menos rígido). |
| Play manual bloqueado com "Rosto não reconhecido" | Olhe pra câmera e clique de novo. A verificação espera até 6s. |
| Play bloqueado com "Cadastre seu rosto" | Com o agente ativo, o timer só inicia depois de cadastrar a foto de referência no popup — proposital, senão não cadastrar viraria bypass da verificação. |
| Play demora alguns segundos pra iniciar | Normal com reconhecimento ligado: o Chrome **liga o agente na hora do play** (câmera sobe em ~3–5s) e verifica seu rosto antes de contar tempo. |
| "Câmera não respondeu" ao dar play | Outro app está usando a câmera (Zoom/Meet?) ou é a primeira execução baixando modelos — feche o app/espere 1 min e tente de novo. |
| Timer pausou e não volta | Veja o motivo no widget. Aba da issue fechada? Reabra. Agente caiu? O pause por câmera deixa de valer sozinho (idle e aba continuam). |
| Popup mostra "Agente não instalado" | Rode o comando de instalação que o próprio popup mostra (botão copiar), **reinicie o Chrome** e clique em "Testar conexão". |
| Popup mostra "Agente desatualizado (vX.Y.Z)" | A extensão detectou agente antigo (recursos novos não fazem efeito nele). Rode o instalador de novo e reinicie o Chrome — o popup passa a mostrar a versão do agente ao lado do status. |
| Sem som no pause/play | Toggle "Tocar som" no popup. A voz toca nas transições automáticas **e** nas ações manuais (play/retomar/encerrar). |
| Quero a minha própria voz nos avisos | Popup → "Vozes dos avisos (MP3)": suba um MP3 (máx 1 MB) pra Pausa, Retomada e/ou Rosto não reconhecido. Fica salvo só no seu Chrome; "Padrão" volta pro mp3 bundlado. |

---

## 📱 Lembrete no WhatsApp (opcional)

Com timer rodando, a cada N minutos (padrão 60) a extensão dispara uma notificação no Chrome e um POST num webhook do n8n — que encaminha pro WhatsApp via Evolution API.

Configuração no popup: URL do webhook + seu número. Ao salvar, o Chrome pede permissão pro host do n8n — aceite.

<details>
<summary>Montar o workflow no n8n</summary>

Payload que a extensão envia:

```json
{
  "event": "timer_reminder",
  "phone": "5548999999999",
  "issue": "THE-558",
  "title": "Definição sobre implementação das telas...",
  "startedAt": "2026-07-09T12:00:00.000Z",
  "elapsedMinutes": 60,
  "elapsedHuman": "1h 00m",
  "message": "⏱️ Timer ativo há 1h 00m na THE-558 — ...\n\nQue tal uma pausa de 5 min? ☕"
}
```

`message` já vem pronto com quebras de linha reais — o n8n só repassa.

1. **Webhook node** — POST, path ex.: `linear-timer`. Use a URL de produção no popup.
2. **HTTP Request node** → Evolution API:
   - URL: `{EVOLUTION_URL}/message/sendText/{INSTANCIA}` · Header: `apikey: {SUA_KEY}`
   - Body **Using Fields Below** (não "Using JSON" — `\n` manual vai literal):
     `number` = `{{ $json.body.phone }}` · `text` = `{{ $json.body.message }}`
     (Evolution v1 usa `textMessage.text` no lugar de `text`.)

O lembrete depende do Chrome aberto — como o timer só roda com você trabalhando no navegador, cobre o caso real.

</details>

---

## 👩‍💻 Para quem desenvolve

```bash
npm install
npm run build   # tsc + vite → dist/
```

Após mudar código: `npm run build` e ↻ na extensão em `chrome://extensions`.

**⚠️ Contrato crítico:** o comentário postado na issue é consumido pela extração de dados da Retech. O formato está isolado em `src/lib/format.ts` — **não alterar** sem atualizar o parser da extração:

```
init_task: 2026-07-09 09:00:00.000000 +00:00
-end_task: 2026-07-09 12:00:00.000000 +00:00-
```

**Estrutura:**

```
manifest.config.ts        # manifest MV3 (CRXJS)
src/
  background.ts           # service worker: timer, presença (idle+câmera+aba), verify, badge, sons, webhook
  content.ts              # widget play/pause injetado no linear.app (shadow DOM)
  offscreen/              # documento offscreen que toca os mp3 (MV3 não toca áudio no SW)
  popup/                  # configurações + cadastro facial
  lib/
    format.ts             # ⚠️ formato exato do comentário + helpers de tempo
    linear.ts             # cliente GraphQL (resolveIssue, commentCreate, viewer)
    storage.ts            # estado do timer + settings em chrome.storage.local
agent/                    # agente local de presença (Python: detecção + liveness + reconhecimento)
public/sounds/            # pause.mp3 / resume.mp3 / unrecognized.mp3
scripts/gen-icons.mjs     # gera PNGs dos ícones sem dependências
```

**Como funciona por dentro:**

- Pause automático fecha o **segmento** atual e posta o comentário na hora; o resume abre segmento novo. Total exibido = segmentos fechados + corrente.
- `background.ts` reavalia presença a cada evento (idle, mensagens do agente, abas) e a cada minuto (alarm). Prioridade do motivo: idle > câmera > aba.
- Agente ↔ extensão: **native messaging** (Chrome spawna o processo ao conectar e o mata no disconnect; a porta aberta mantém o service worker MV3 vivo) com fallback WebSocket em `ws://127.0.0.1:8998` para o modo manual. Só booleanos trafegam. Payload, protocolo de enroll/verify e anti-spoofing (re-arm): [agent/README.md](agent/README.md).
- O ID da extensão é **pinado** via `key` no manifest (`knbbiaoppepegcmdplehglahbdkghclh`) — o host manifest do native messaging autoriza esse ID. A chave privada `retech-timer.pem` fica fora do git; ao atualizar de versões antigas o ID muda e as configurações resetam (reconfigurar 1x).
- Play/resume manual com agente ativo + rosto cadastrado passa por `verify` (espera até 6s por match fresco). Agente offline/sem cadastro → play normal, por decisão — consistente com o auto-pause, que também não trava com o agente fora do ar.

**Release para o time:** push de tag `v*` dispara o GitHub Actions, que builda e anexa o zip numa Release:

```bash
git tag v0.3.0 && git push origin v0.3.0
```

<details>
<summary>Publicar na Chrome Web Store</summary>

1. Conta no [Developer Dashboard](https://chrome.google.com/webstore/devconsole) — taxa única de US$ 5.
2. `npm run zip` → **New item** → upload.
3. Descrição, ícone 128px (`public/icons/`), screenshots 1280×800, categoria *Workflow & Planning*.
4. **Privacy**: single purpose = "time tracking em issues do Linear"; justificar permissões (`storage` = configurações, `alarms` = cronômetro/lembrete, `notifications` = lembrete de pausa, `idle` = auto-pause por inatividade, `tabs` = detectar aba da issue, `offscreen` = aviso sonoro, host `api.linear.app` = criar comentários).
5. **Visibility: Unlisted** — só instala quem tem o link.
6. Review: 1–3 dias úteis. Atualizações: novo zip com `version` incrementada no `manifest.config.ts`.

</details>

## Roadmap

Plano vivo em **[docs/ROADMAP.md](docs/ROADMAP.md)** — inclui a v0.4 (OAuth, relatório semanal, dashboard) e a trilha de produto para o Integration Directory do Linear.
