# Sons de pause/play

Coloque aqui os áudios de voz tocados nas transições automáticas do timer:

- `pause.mp3` — toca quando o timer pausa automaticamente
- `resume.mp3` — toca quando o timer volta a rodar automaticamente
- `unrecognized.mp3` — toca quando o reconhecimento facial falha (play manual
  bloqueado ou auto-pause por rosto não reconhecido)

Sem os arquivos, o aviso sonoro é um no-op silencioso (nada quebra).
Ações manuais também tocam: play/retomar usa `resume.mp3` e Encerrar usa
`pause.mp3` (respeitando o toggle "Tocar som").

Estes são os **padrões bundlados**. Cada dev pode sobrescrever qualquer um
deles pelo popup ("Vozes dos avisos (MP3)") sem tocar no repo — o MP3 fica
salvo em `chrome.storage.local` só naquele Chrome, e "Padrão" volta pra estes.
