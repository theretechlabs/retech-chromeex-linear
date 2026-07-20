# Retech Presence Agent

Agente local (Mac / Windows / Linux) que detecta presença do dev pela webcam e
alimenta o play/pause automático da extensão **Retech Linear Timer**.

## Como funciona

- Captura ~5 frames/s da webcam e roda face detection + **prova de vida**
  (MediaPipe FaceLandmarker) **100% local**.
- **Liveness anti-spoofing:** uma foto (impressa ou na tela de um celular) tem
  rosto mas **nunca pisca**. O agente mede os blendshapes de piscada
  (`eyeBlinkLeft/Right`). A piscada é **prova de entrada, com latch**: piscou
  uma vez, a prova de vida vale enquanto o rosto permanecer continuamente na
  câmera — lendo um doc sem piscar ou olhando o monitor ao lado, o timer não
  cai. Não dá pra trocar o dev por uma foto sem o rosto sumir por >8s, o que
  zera o latch (re-arm) e exige piscada nova.
- **Re-arm:** se o rosto some por >8s (`--rearm-seconds`) e reaparece, os
  créditos de piscada e de reconhecimento zeram. Presença ainda de pé (gap
  curto — desviou o olhar, consultou o monitor do lado) → 12s de carência
  (`--blink-grace`) pra não derrubar o dev real. Já **ausente** → sem carência:
  o rosto que voltou só conta depois de piscar **e** ser reconhecido. Foto ou
  estranho colocados na ausência não ganham nem um segundo de presença.
- **Reconhecimento facial (verificação de identidade):** o dev cadastra uma
  foto de referência pelo popup da extensão; o agente extrai um embedding
  SFace (128-d) e persiste **só o embedding** (não a foto) em
  `~/.cache/retech-presence-agent/face_embedding.json`. Com rosto cadastrado,
  presença exige que **algum** rosto no frame bata com a referência (cosine ≥
  `--recognition-threshold`, default 0.363) nos últimos `--match-window`
  segundos (default 10) — um estranho na frente da câmera conta como ausente;
  dev com alguém do lado continua presente. Modelos YuNet (~230KB) + SFace
  (~37MB) do opencv_zoo, embutidos no OpenCV — funciona também no fallback
  Haar. O re-arm zera o crédito de match igual ao de piscada. `--no-recognition`
  desliga; sem foto cadastrada, nada muda.
- Publica só booleanos num WebSocket em `ws://127.0.0.1:8998`.
- Rosto visto + piscada na entrada (+ rosto reconhecido, se cadastrado) →
  `present: true`. Sem rosto por `--grace` segundos (default 15), rosto que
  voltou e ainda não piscou, **ou** rosto não reconhecido → `present: false`.
- A extensão pausa o timer quando `present: false` e retoma quando `true`
  (combinado com a regra de inatividade de teclado/mouse e a aba da issue).
- Sem MediaPipe/modelo disponível, cai para Haar cascade do OpenCV **sem**
  liveness (avisa no log). `--no-liveness` força esse modo.

> Limite honesto: liveness por piscada barra foto/print. Um **vídeo** de
> alguém piscando ainda engana — anti-spoofing de nível bancário (análise de
> textura/profundidade) fica fora do escopo.

**Privacidade:** nenhum frame é gravado nem sai do processo. Só booleanos
trafegam, e apenas via loopback (127.0.0.1). A foto de referência vira um
embedding numérico irreversível e é descartada; nada de imagem em disco. O LED
da câmera fica aceso enquanto o agente roda — é o indicador de que está ativo.
Os modelos (FaceLandmarker ~4MB de `storage.googleapis.com`; YuNet + SFace
~38MB do GitHub `opencv_zoo`, SHA pinado) são baixados uma única vez e
cacheados em `~/.cache/retech-presence-agent/` (ou passe `--model`,
`--yunet-model`, `--sface-model` para rodar offline). Se o download do
opencv_zoo vier truncado (limite de banda do Git LFS), o agente detecta,
avisa e segue **sem** reconhecimento.

O MediaPipe embute telemetria de uso do Google (clearcut →
`play.googleapis.com/log`, só eventos de API, nunca imagens) **sem opt-out
oficial**. O agente bloqueia isso apontando o proxy HTTP do próprio processo
para um endereço morto depois de baixar o modelo — o upload morre localmente.
Se aparecer `Failed to send to clearcut` no encerramento, é essa telemetria
falhando: cosmético, ignorar.

## Dois modos de execução

- **Native messaging (`--native`)** — modo automático: o **Chrome inicia e
  encerra o agente sozinho** via `chrome.runtime.connectNative`, conversando
  por stdio (frames de 4 bytes little-endian + JSON UTF-8). O processo vive
  enquanto a extensão mantiver a porta aberta e **sai quando o stdin fecha**
  → câmera ligada só com timer ativo. Requer o host registrado no navegador
  (feito pelo script de instalação — ver README da raiz). Em `--native` o
  stdout pertence ao framing: logs vão para stderr e `--show` é ignorado.
- **WebSocket (default)** — modo manual/debug/legado: você roda o agente no
  terminal e ele serve `ws://127.0.0.1:8998`.

Flags úteis para automação:

```bash
python presence_agent.py --download-models   # pré-baixa os 3 modelos e sai (instalador usa)
RETECH_PRESENCE_CACHE=/tmp/cache-isolado …   # muda o dir de cache (modelos + embedding); útil em testes
```

## Instalação manual (modo WebSocket/debug)

Requer Python 3.10+.

```bash
cd agent
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Uso (modo WebSocket)

```bash
python presence_agent.py                    # defaults: porta 8998, câmera 0, grace 15s, rearm 8s, blink-grace 12s
python presence_agent.py --show             # janela de preview para debug (q sai)
python presence_agent.py --grace 30         # mais tolerante a olhar de lado
python presence_agent.py --blink-window 40  # mais tolerante a olhar fixo sem piscar
python presence_agent.py --no-liveness      # desliga a prova de vida (aceita rosto estático)
python presence_agent.py --no-recognition   # desliga o reconhecimento (aceita qualquer rosto)
python presence_agent.py --match-window 20  # mais tolerante a não reconhecer (óculos, luz)
python presence_agent.py --recognition-threshold 0.30  # menos rígido no match
python presence_agent.py --camera 1         # outra webcam
```

Depois, no popup da extensão: marcar **"Usar agente de câmera"** e salvar
(porta igual à do agente).

No macOS, na primeira execução o sistema pede permissão de câmera para o
terminal/Python — aceitar.

## Iniciar junto com o sistema (opcional)

- **macOS:** LaunchAgent em `~/Library/LaunchAgents` chamando o Python do venv.
- **Windows:** atalho na pasta `shell:startup` ou Task Scheduler.
- **Linux:** unidade systemd `--user`.

## Protocolo

Mensagens JSON enviadas a todo cliente conectado (na conexão, a cada mudança e
como heartbeat a cada ~20s — o heartbeat também mantém o service worker MV3 da
extensão acordado):

```json
{"type": "presence", "present": true, "faces": 1, "live": true, "recognized": true, "ts": 1720900000.0}
```

`present` já embute prova de vida **e** reconhecimento — a extensão decide
play/pause só por `present`. `recognized` é `null` quando não há rosto
cadastrado (ou reconhecimento indisponível/desligado); a extensão o usa apenas
para rotular o pause como "rosto não reconhecido" em vez de "ausente".

O agente também aceita comandos (JSON, resposta só para quem pediu):

```jsonc
// cadastrar foto de referência (JPEG/PNG em base64, sem prefixo data:)
{"type": "enroll", "id": "uuid", "image": "<base64>"}
// → {"type": "enroll_result", "id": "uuid", "ok": true}
// → {"type": "enroll_result", "id": "uuid", "ok": false,
//    "error": "no_face" | "multiple_faces" | "decode_error" | "recognition_unavailable"}

{"type": "unenroll", "id": "uuid"}        // → {"type": "unenroll_result", "id", "ok": true}
{"type": "get_enrollment", "id": "uuid"}  // → {"type": "enrollment", "id", "enrolled", "available"}

// verificação sob demanda (play/resume manual da extensão): espera até ~6s
// por um match fresco do rosto cadastrado
{"type": "verify", "id": "uuid"}
// → {"type": "verify_result", "id": "uuid", "ok": true, "recognized": true|false}
// → sem cadastro: {"recognized": null, "available": true|false, "enrolled": false}
//   available && !enrolled → a extensão BLOQUEIA o play ("cadastre seu rosto");
//   reconhecimento indisponível (available: false) → extensão deixa passar
```

A foto de enroll deve ter **exatamente um** rosto. Após enroll/unenroll o
agente zera o crédito de match e abre a carência do `--blink-grace` (~12s)
para a nova referência assumir sem flap de pause.
