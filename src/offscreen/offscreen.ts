// Offscreen document (MV3): única superfície com DOM disponível para o SW
// tocar áudio. Recebe PLAY_SOUND do background com o `src` já resolvido —
// dataURL do mp3 personalizado do dev, ou URL do mp3 bundlado (public/sounds/).
// Chrome fecha este documento sozinho ~30s após o áudio terminar.

chrome.runtime.onMessage.addListener((msg: { type?: string; src?: string }) => {
  if (msg?.type !== 'PLAY_SOUND' || !msg.src) return
  const audio = new Audio(msg.src)
  audio.volume = 0.8
  // mp3 ainda não enviado → play() rejeita e o aviso vira no-op silencioso.
  void audio.play().catch(() => undefined)
})
