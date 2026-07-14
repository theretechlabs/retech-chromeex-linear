// Offscreen document (MV3): única superfície com DOM disponível para o SW
// tocar áudio. Recebe PLAY_SOUND do background e toca public/sounds/<nome>.mp3.
// Chrome fecha este documento sozinho ~30s após o áudio terminar.

chrome.runtime.onMessage.addListener((msg: { type?: string; sound?: string }) => {
  if (msg?.type !== 'PLAY_SOUND' || !msg.sound) return
  const audio = new Audio(chrome.runtime.getURL(`sounds/${msg.sound}.mp3`))
  audio.volume = 0.8
  // mp3 ainda não enviado → play() rejeita e o aviso vira no-op silencioso.
  void audio.play().catch(() => undefined)
})
