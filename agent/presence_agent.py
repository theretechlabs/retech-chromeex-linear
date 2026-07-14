#!/usr/bin/env python3
"""Retech Presence Agent — detecção de presença por câmera para a extensão
Retech Linear Timer.

Captura frames da webcam, roda face detection + prova de vida (liveness) +
reconhecimento facial 100% local e expõe um WebSocket em 127.0.0.1 que
publica apenas booleanos de presença:

    {"type": "presence", "present": true, "faces": 1, "live": true,
     "recognized": true, "ts": ...}

Liveness (anti-spoofing passivo): usa o FaceLandmarker do MediaPipe (API
tasks) para medir os blendshapes de piscada (eyeBlinkLeft/Right). Rosto só
conta como presente se **piscou** nos últimos --blink-window segundos — uma
foto (impressa ou na tela do celular) tem rosto mas nunca pisca, então não
segura o timer. Humanos piscam ~15-20x/min; até olhando fixo pra tela ficam
em ~4-7x/min, então a janela padrão de 20s é suficiente.

Re-arm: se o rosto some por mais de REARM_SECONDS e reaparece, os créditos de
piscada e de reconhecimento são zerados. Se a presença ainda estava de pé
(gap curto — dev desviou o olhar), há uma carência de REARM_BLINK_GRACE para
não derrubar o dev real; se já estava AUSENTE, não há carência: o rosto que
voltou só conta como presente DEPOIS de piscar e ser reconhecido — senão
qualquer rosto retomaria o timer por alguns segundos sem verificação.

Reconhecimento facial (verificação de identidade): a extensão cadastra uma
foto de referência via WebSocket ({"type": "enroll", "image": base64}); o
agente extrai um embedding SFace (128-d) e persiste só o embedding (não a
foto) em ~/.cache/retech-presence-agent/face_embedding.json. Com rosto
cadastrado, presença exige que ALGUM rosto no frame bata com a referência
(cosine >= --recognition-threshold) dentro de --match-window segundos —
um estranho na frente da câmera conta como ausente. Modelos: YuNet
(detector, ~230KB) + SFace (~37MB) do opencv_zoo, embutidos no OpenCV.
O re-arm também zera o crédito de match. Desligue com --no-recognition.

Fallback: sem MediaPipe/modelo, cai para Haar cascade do OpenCV **sem**
liveness (com aviso no log). Reconhecimento é independente do MediaPipe e
funciona também no fallback.

Privacidade: nenhum frame é gravado nem sai do processo; só booleanos
trafegam, e só via loopback. O LED da câmera fica aceso enquanto o agente
roda. Os modelos (~42MB no total) são baixados uma única vez para
~/.cache/retech-presence-agent/.

Histerese: rosto visto → presente na hora (após a 1ª piscada); ausente só
após --grace segundos sem rosto (evita pause por olhar de lado).

Heartbeat a cada ~20s mantém o service worker MV3 da extensão acordado.

Uso:
    python presence_agent.py [--port 8998] [--camera 0] [--grace 15]
                             [--blink-window 20] [--no-liveness]
                             [--no-recognition] [--match-window 10]
                             [--recognition-threshold 0.363]
                             [--interval 0.2] [--show]
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import threading
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import websockets

log = logging.getLogger("presence-agent")

HEARTBEAT_SECONDS = 20.0
DETECT_WIDTH = 480  # frames reduzidos p/ detecção: rápido e pega rosto a ~2m

LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
MODEL_CACHE = Path.home() / ".cache" / "retech-presence-agent" / "face_landmarker.task"
BLINK_THRESHOLD = 0.5  # score de blendshape acima disso = olho fechado
REARM_SECONDS = 3.0  # rosto sumiu por mais que isso → nova piscada obrigatória
REARM_BLINK_GRACE = 5.0  # carência p/ piscar após o re-arm sem derrubar presença

# Reconhecimento facial (opencv_zoo, SHA pinado — repo usa Git LFS e o raw
# redireciona para media.githubusercontent.com; pointer LFS tem ~130 bytes,
# por isso o tamanho é validado após o download).
_ZOO = "https://github.com/opencv/opencv_zoo/raw/47534e27c9851bb1128ccc0102f1145e27f23f98/models"
YUNET_URL = f"{_ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = f"{_ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx"
YUNET_CACHE = MODEL_CACHE.parent / "face_detection_yunet_2023mar.onnx"
SFACE_CACHE = MODEL_CACHE.parent / "face_recognition_sface_2021dec.onnx"
EMBEDDING_PATH = MODEL_CACHE.parent / "face_embedding.json"
COSINE_THRESHOLD = 0.363  # threshold oficial do SFace no opencv_zoo (cosine)
RECOG_INTERVAL = 1.0  # reconhecimento no máx 1x/s (mais caro que detecção)
VERIFY_TIMEOUT = 6.0  # segundos que o comando "verify" espera por um match fresco


def downscale(frame):
    height, width = frame.shape[:2]
    if width <= DETECT_WIDTH:
        return frame
    scale = DETECT_WIDTH / width
    return cv2.resize(frame, (DETECT_WIDTH, int(height * scale)))


class HaarDetector:
    """Fallback sem liveness: só conta rostos (Haar cascade embutido no cv2)."""

    liveness = False

    def __init__(self) -> None:
        self.cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        if self.cascade.empty():
            raise RuntimeError(
                "Haar cascade não carregou; instale opencv-contrib-python<5"
            )

    def detect(self, frame) -> tuple[int, bool]:
        gray = cv2.equalizeHist(cv2.cvtColor(downscale(frame), cv2.COLOR_BGR2GRAY))
        faces = self.cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(48, 48)
        )
        return len(faces), False


class LandmarkerDetector:
    """MediaPipe FaceLandmarker (tasks): rostos + evento de piscada (liveness)."""

    liveness = True

    def __init__(self, model_path: Path) -> None:
        import mediapipe as mp
        from mediapipe.tasks import python as mp_tasks
        from mediapipe.tasks.python import vision

        self._mp = mp
        options = vision.FaceLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            output_face_blendshapes=True,
            num_faces=1,
        )
        self.landmarker = vision.FaceLandmarker.create_from_options(options)
        self._prev_score = 0.0
        self._ts_ms = 0

    def detect(self, frame) -> tuple[int, bool]:
        rgb = cv2.cvtColor(downscale(frame), cv2.COLOR_BGR2RGB)
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        # detect_for_video exige timestamps estritamente crescentes.
        self._ts_ms = max(self._ts_ms + 1, int(time.monotonic() * 1000))
        result = self.landmarker.detect_for_video(image, self._ts_ms)

        faces = len(result.face_landmarks)
        blinked = False
        if result.face_blendshapes:
            scores = {c.category_name: c.score for c in result.face_blendshapes[0]}
            score = max(scores.get("eyeBlinkLeft", 0.0), scores.get("eyeBlinkRight", 0.0))
            # Piscada = borda de subida cruzando o threshold; foto estática não gera borda.
            blinked = score >= BLINK_THRESHOLD and self._prev_score < BLINK_THRESHOLD
            self._prev_score = score
        else:
            self._prev_score = 0.0
        return faces, blinked


def ensure_download(
    path_arg: str | None, url: str, cache: Path, label: str, min_size: int = 1024
) -> Path:
    if path_arg:
        path = Path(path_arg)
        if not path.exists():
            raise FileNotFoundError(f"Modelo não encontrado: {path}")
        return path
    if cache.exists() and cache.stat().st_size >= min_size:
        return cache
    cache.parent.mkdir(parents=True, exist_ok=True)
    log.info("Baixando %s (só na primeira vez)…", label)
    tmp = cache.with_suffix(".tmp")
    urllib.request.urlretrieve(url, tmp)
    if tmp.stat().st_size < min_size:
        tmp.unlink()
        raise RuntimeError(
            f"download de {label} veio truncado (pointer Git LFS?); "
            f"baixe manualmente de {url}"
        )
    tmp.rename(cache)
    log.info("Modelo salvo em %s", cache)
    return cache


def ensure_model(path_arg: str | None) -> Path:
    return ensure_download(
        path_arg, LANDMARKER_URL, MODEL_CACHE, "FaceLandmarker (~4MB)", min_size=1024 * 1024
    )


class FaceRecognizer:
    """Verificação de identidade: YuNet (detector) + SFace (embedding 128-d).

    Independente do MediaPipe — funciona também no fallback Haar. O match roda
    no frame FULL-RES (não no downscale de 480px): o alignCrop do SFace warpa
    para 112x112 a partir do frame de origem e degrada com rosto <80px.

    Lock: enroll chega pela thread do WebSocket (asyncio.to_thread) enquanto
    match roda na thread do loop de detecção; objetos cv2 não são thread-safe.
    """

    def __init__(self, yunet_path: Path, sface_path: Path, threshold: float) -> None:
        self.threshold = threshold
        self._lock = threading.Lock()
        self.detector = cv2.FaceDetectorYN.create(str(yunet_path), "", (320, 320), 0.7, 0.3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(str(sface_path), "")
        self.reference: np.ndarray | None = None
        if EMBEDDING_PATH.exists():
            try:
                data = json.loads(EMBEDDING_PATH.read_text())
                self.reference = np.array(data["embedding"], dtype=np.float32).reshape(1, -1)
                log.info("Embedding de referência carregado (%s)", EMBEDDING_PATH)
            except Exception as e:
                log.warning("Embedding de referência inválido (%s); ignorando", e)

    @property
    def enrolled(self) -> bool:
        return self.reference is not None

    def _detect(self, image: np.ndarray) -> np.ndarray:
        height, width = image.shape[:2]
        self.detector.setInputSize((width, height))
        _, faces = self.detector.detect(image)
        return faces if faces is not None else np.empty((0, 15), dtype=np.float32)

    def enroll(self, image: np.ndarray) -> tuple[bool, str | None]:
        with self._lock:
            faces = self._detect(image)
            if len(faces) == 0:
                return False, "no_face"
            if len(faces) > 1:
                return False, "multiple_faces"
            aligned = self.recognizer.alignCrop(image, faces[0])
            feature = self.recognizer.feature(aligned)
            payload = {
                "model": "sface_2021dec",
                "created": time.time(),
                "embedding": feature.flatten().tolist(),
            }
            EMBEDDING_PATH.parent.mkdir(parents=True, exist_ok=True)
            tmp = EMBEDDING_PATH.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload))
            tmp.rename(EMBEDDING_PATH)
            self.reference = feature.copy()
            return True, None

    def unenroll(self) -> None:
        with self._lock:
            EMBEDDING_PATH.unlink(missing_ok=True)
            self.reference = None

    def match(self, frame: np.ndarray) -> bool:
        """True se QUALQUER rosto do frame bate com a referência — dev com
        acompanhante ao lado não pausa; estranho sozinho não segura o timer."""
        with self._lock:
            if self.reference is None:
                return False
            faces = self._detect(frame)
            # Até 5 rostos, dos com maior score de detecção (última coluna).
            order = faces[:, -1].argsort()[::-1][:5]
            for idx in order:
                aligned = self.recognizer.alignCrop(frame, faces[idx])
                feature = self.recognizer.feature(aligned)
                score = self.recognizer.match(
                    feature, self.reference, cv2.FaceRecognizerSF_FR_COSINE
                )
                if score >= self.threshold:
                    return True
            return False


def build_recognizer(args: argparse.Namespace) -> FaceRecognizer | None:
    if args.no_recognition:
        log.info("Reconhecimento facial DESLIGADO (--no-recognition)")
        return None
    try:
        yunet = ensure_download(
            args.yunet_model, YUNET_URL, YUNET_CACHE, "YuNet (~230KB)", min_size=100_000
        )
        sface = ensure_download(
            args.sface_model, SFACE_URL, SFACE_CACHE, "SFace (~37MB)", min_size=1024 * 1024
        )
        recognizer = FaceRecognizer(yunet, sface, args.recognition_threshold)
        log.info(
            "Reconhecimento facial disponível — %s",
            "rosto cadastrado, verificação ATIVA" if recognizer.enrolled
            else "nenhum rosto cadastrado (cadastre pela extensão)",
        )
        return recognizer
    except Exception as e:
        log.warning(
            "Reconhecimento facial indisponível (%s); seguindo sem verificação de identidade", e
        )
        return None


def decode_image(b64: object) -> np.ndarray | None:
    if not isinstance(b64, str) or not b64:
        return None
    try:
        raw = base64.b64decode(b64)
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        return image if image is not None and image.size else None
    except Exception:
        return None


def block_telemetry() -> None:
    """O MediaPipe embute telemetria do Google (clearcut → play.googleapis.com)
    sem opt-out oficial. Aponta o proxy HTTP deste processo para um endereço
    morto: o upload falha localmente e nada sai da máquina. Chamar DEPOIS do
    download do modelo e ANTES de importar o mediapipe. Não afeta o agente:
    o WebSocket é servidor local e a câmera não usa rede."""
    for var in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
        os.environ[var] = "http://127.0.0.1:9"
    for var in ("no_proxy", "NO_PROXY"):
        os.environ.pop(var, None)
    # Silencia o spam I0000/W0000 do glog/absl no stderr (só warnings+).
    os.environ.setdefault("GLOG_minloglevel", "1")


def build_detector(args: argparse.Namespace) -> HaarDetector | LandmarkerDetector:
    if args.no_liveness:
        log.info("Liveness DESLIGADO (--no-liveness); usando Haar cascade")
        return HaarDetector()
    try:
        model = ensure_model(args.model)
        block_telemetry()
        detector = LandmarkerDetector(model)
        log.info(
            "Liveness LIGADO: presença exige piscada a cada %.0fs", args.blink_window
        )
        return detector
    except Exception as e:  # mediapipe ausente, sem rede p/ modelo, etc.
        log.warning("Liveness indisponível (%s); caindo para Haar SEM prova de vida", e)
        return HaarDetector()


class PresenceState:
    """Estado compartilhado + broadcast para os clientes conectados."""

    def __init__(self) -> None:
        self.present = False
        self.faces = 0
        self.live = False
        self.recognized: bool | None = None  # None = reconhecimento off/sem cadastro
        # Último match da referência (epoch); compartilhado p/ o comando "verify".
        self.last_match_at = 0.0
        # Setado pelo handler WS após enroll/unenroll: o loop zera o crédito de
        # match e abre uma carência (rearm) p/ a nova referência assumir sem flap.
        self.match_invalidated = False
        self.clients: set = set()

    def payload(self) -> str:
        return json.dumps(
            {
                "type": "presence",
                "present": self.present,
                "faces": self.faces,
                "live": self.live,
                "recognized": self.recognized,
                "ts": time.time(),
            }
        )

    async def broadcast(self) -> None:
        if not self.clients:
            return
        message = self.payload()
        await asyncio.gather(
            *(client.send(message) for client in set(self.clients)),
            return_exceptions=True,
        )


async def detection_loop(
    state: PresenceState, args: argparse.Namespace, recognizer: FaceRecognizer | None
) -> None:
    """Captura + detecção com histerese; broadcast em mudança e heartbeat."""
    detector = build_detector(args)

    capture: cv2.VideoCapture | None = None
    last_face_at = 0.0
    last_blink_at = 0.0
    last_recog_at = 0.0
    rearm_deadline = 0.0
    last_broadcast = 0.0

    while True:
        if capture is None or not capture.isOpened():
            capture = cv2.VideoCapture(args.camera)
            if not capture.isOpened():
                log.warning("Câmera %s indisponível; tentando de novo em 5s", args.camera)
                capture.release()
                capture = None
                await asyncio.sleep(5)
                continue
            log.info("Câmera %s aberta", args.camera)

        ok, frame = await asyncio.to_thread(capture.read)
        now = time.time()
        if not ok:
            log.warning("Falha ao ler frame; reabrindo câmera")
            capture.release()
            capture = None
            continue

        enforce_match = recognizer is not None and recognizer.enrolled

        # Enroll/unenroll acabou de acontecer: zera o crédito de match e abre
        # carência p/ a nova referência dar o primeiro match sem flap de pausa.
        if state.match_invalidated:
            state.match_invalidated = False
            state.last_match_at = 0.0
            rearm_deadline = max(rearm_deadline, now + REARM_BLINK_GRACE)

        faces, blinked = await asyncio.to_thread(detector.detect, frame)
        if faces > 0:
            # Re-arm: rosto reapareceu após um gap → exige piscada/match novos
            # antes de contar presença (foto colocada na ausência não herda
            # crédito; estranho que sentou no lugar também não).
            if (
                (detector.liveness or enforce_match)
                and last_face_at
                and (now - last_face_at) > REARM_SECONDS
            ):
                last_blink_at = 0.0
                state.last_match_at = 0.0
                # Carência só se a presença AINDA está de pé (gap curto: dev
                # desviou o olhar) — evita derrubar o dev real enquanto pisca.
                # Já ausente (present false) não ganha carência: o rosto que
                # voltou só conta DEPOIS de piscar e ser reconhecido — senão
                # qualquer rosto retomaria o timer por 5s sem verificação.
                rearm_deadline = now + REARM_BLINK_GRACE if state.present else 0.0
                log.info(
                    "Rosto voltou após %.0fs; aguardando prova de vida/reconhecimento%s",
                    now - last_face_at,
                    "" if state.present else " (sem carência: estava ausente)",
                )
            last_face_at = now
        if blinked:
            last_blink_at = now

        # Reconhecimento: mais caro que detecção → no máx 1x/s e só com rosto.
        if enforce_match and faces > 0 and (now - last_recog_at) >= RECOG_INTERVAL:
            last_recog_at = now
            if await asyncio.to_thread(recognizer.match, frame):
                state.last_match_at = now

        # Presença = rosto no grace E prova de vida na janela E rosto cadastrado
        # reconhecido na janela (quando há cadastro).
        face_ok = bool(last_face_at) and (now - last_face_at) <= args.grace
        live_ok = (
            not detector.liveness
            or (bool(last_blink_at) and (now - last_blink_at) <= args.blink_window)
            or now < rearm_deadline
        )
        match_ok = (
            not enforce_match
            or (bool(state.last_match_at) and (now - state.last_match_at) <= args.match_window)
            or now < rearm_deadline
        )
        present = face_ok and live_ok and match_ok

        recognized = match_ok if enforce_match else None
        live = live_ok if detector.liveness else True
        # Broadcast também quando rosto aparece/some e quando liveness vira:
        # a extensão usa faces/live/recognized p/ rotular o pause ("rosto não
        # reconhecido", "pisque para a câmera") — sem isso o rótulo só
        # atualizaria no heartbeat (~20s).
        changed = (
            present != state.present
            or recognized != state.recognized
            or (faces > 0) != (state.faces > 0)
            or live != state.live
        )
        state.present = present
        state.faces = faces
        state.live = live
        state.recognized = recognized

        if changed or (now - last_broadcast) >= HEARTBEAT_SECONDS:
            last_broadcast = now
            await state.broadcast()
            if changed:
                if present or not face_ok:
                    detail = ""
                elif not match_ok:
                    detail = " (rosto não reconhecido)"
                else:
                    detail = " (rosto sem piscada — foto?)"
                log.info(
                    "Presença: %s (%d rosto(s))%s",
                    "SIM" if present else "NÃO",
                    faces,
                    detail,
                )

        if args.show:
            label = f"present={present} faces={faces} live={state.live} rec={state.recognized}"
            cv2.putText(frame, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                        (0, 255, 0) if present else (0, 0, 255), 2)
            cv2.imshow("retech-presence-agent", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

        await asyncio.sleep(args.interval)


async def serve(args: argparse.Namespace) -> None:
    state = PresenceState()
    # Antes do build_detector: os downloads do opencv_zoo precisam acontecer
    # antes de block_telemetry() envenenar o proxy HTTP do processo.
    recognizer = build_recognizer(args)

    async def handle_command(msg: dict) -> dict | None:
        mtype = msg.get("type")
        mid = msg.get("id")
        if mtype == "enroll":
            if recognizer is None:
                return {"type": "enroll_result", "id": mid, "ok": False,
                        "error": "recognition_unavailable"}
            image = decode_image(msg.get("image"))
            if image is None:
                return {"type": "enroll_result", "id": mid, "ok": False,
                        "error": "decode_error"}
            ok, error = await asyncio.to_thread(recognizer.enroll, image)
            if not ok:
                return {"type": "enroll_result", "id": mid, "ok": False, "error": error}
            state.match_invalidated = True
            log.info("Rosto de referência cadastrado; verificação ATIVA")
            await state.broadcast()
            return {"type": "enroll_result", "id": mid, "ok": True}
        if mtype == "unenroll":
            if recognizer is not None and recognizer.enrolled:
                await asyncio.to_thread(recognizer.unenroll)
                state.match_invalidated = True
                log.info("Rosto de referência removido; verificação desativada")
                await state.broadcast()
            return {"type": "unenroll_result", "id": mid, "ok": True}
        if mtype == "get_enrollment":
            return {
                "type": "enrollment",
                "id": mid,
                "enrolled": bool(recognizer and recognizer.enrolled),
                "available": recognizer is not None,
            }
        if mtype == "verify":
            # Verificação sob demanda (play manual da extensão): espera um match
            # FRESCO do loop de detecção. Sem cadastro/reconhecimento não há o
            # que verificar → recognized: null (extensão deixa passar).
            if recognizer is None or not recognizer.enrolled:
                return {"type": "verify_result", "id": mid, "ok": True, "recognized": None}
            start = time.time()
            # Match de até 1 ciclo atrás já vale: dev sentado é reconhecido 1x/s.
            fresh_since = start - RECOG_INTERVAL
            while time.time() - start < VERIFY_TIMEOUT:
                if state.last_match_at >= fresh_since:
                    return {"type": "verify_result", "id": mid, "ok": True, "recognized": True}
                await asyncio.sleep(0.25)
            return {"type": "verify_result", "id": mid, "ok": True, "recognized": False}
        return None  # mensagem desconhecida: ignora (comportamento antigo)

    async def handler(websocket) -> None:
        state.clients.add(websocket)
        log.info("Extensão conectada (%d cliente(s))", len(state.clients))
        try:
            await websocket.send(state.payload())
            async for raw in websocket:
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
                if not isinstance(msg, dict):
                    continue
                reply = await handle_command(msg)
                if reply is not None:
                    await websocket.send(json.dumps(reply))
        finally:
            state.clients.discard(websocket)
            log.info("Extensão desconectada (%d cliente(s))", len(state.clients))

    # max_size default (1MB) é apertado p/ foto de enroll em base64.
    async with websockets.serve(handler, "127.0.0.1", args.port, max_size=5 * 1024 * 1024):
        log.info("WebSocket em ws://127.0.0.1:%d — Ctrl+C para sair", args.port)
        await detection_loop(state, args, recognizer)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Retech Presence Agent (face detection + liveness, 100% local)"
    )
    parser.add_argument("--port", type=int, default=8998, help="porta do WebSocket (default 8998)")
    parser.add_argument("--camera", type=int, default=0, help="índice da câmera (default 0)")
    parser.add_argument("--grace", type=float, default=15.0,
                        help="segundos sem rosto até considerar ausente (default 15)")
    parser.add_argument("--blink-window", type=float, default=20.0,
                        help="segundos sem piscada até considerar não-vivo (default 20)")
    parser.add_argument("--no-liveness", action="store_true",
                        help="desliga a prova de vida (volta a aceitar rosto estático)")
    parser.add_argument("--no-recognition", action="store_true",
                        help="desliga o reconhecimento facial (aceita qualquer rosto)")
    parser.add_argument("--match-window", type=float, default=10.0,
                        help="segundos sem reconhecer o rosto cadastrado até considerar "
                             "ausente (default 10)")
    parser.add_argument("--recognition-threshold", type=float, default=COSINE_THRESHOLD,
                        help=f"similaridade cosine mínima do SFace (default {COSINE_THRESHOLD})")
    parser.add_argument("--model", type=str, default=None,
                        help="caminho do face_landmarker.task (default: baixa e cacheia)")
    parser.add_argument("--yunet-model", type=str, default=None,
                        help="caminho do face_detection_yunet_2023mar.onnx (default: baixa)")
    parser.add_argument("--sface-model", type=str, default=None,
                        help="caminho do face_recognition_sface_2021dec.onnx (default: baixa)")
    parser.add_argument("--interval", type=float, default=None,
                        help="segundos entre frames (default 0.1 com liveness, 0.5 sem)")
    parser.add_argument("--show", action="store_true",
                        help="janela de preview para debug (q para sair)")
    args = parser.parse_args()
    if args.interval is None:
        # Piscada dura ~100-300ms: a 5fps muitas caem entre frames e o dev fica
        # esperando a próxima; 10fps captura com folga e o resume sai em ~1-3s.
        args.interval = 0.5 if args.no_liveness else 0.1

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        asyncio.run(serve(args))
    except KeyboardInterrupt:
        log.info("Encerrado")


if __name__ == "__main__":
    main()
