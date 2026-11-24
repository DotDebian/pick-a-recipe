"""Shared Parakeet (Moondream Photon) model — loaded once per process.

Parakeet Ultra / Redux are NVIDIA Parakeet TDT 0.6B v3 post-trained by
Moondream and served by their Photon runtime. On CPU, Ultra transcribes a
90 s clip in ~10 s on an 8-thread desktop CPU (AVX2, no GPU), about 3x faster than Whisper
small, and more accurately. The model covers 25 European languages; audio in
anything else (Hebrew, Arabic, Asian languages) should use Whisper.
"""

from __future__ import annotations

import os
import threading
from typing import Any

from config import config
from helpers import setup_logger

logger = setup_logger(__name__)

# Languages parakeet-tdt-0.6b-v3 was trained on (ISO 639-1).
SUPPORTED_LANGUAGES = frozenset({
    "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu",
    "it", "lv", "lt", "mt", "pl", "pt", "ro", "ru", "sk", "sl", "es", "sv", "uk",
})

_lock = threading.Lock()
_client: Any = None
_client_model: str | None = None


def _device() -> str:
    return os.environ.get("PARAKEET_DEVICE", "").strip() or "cpu"


def _get_client(model: str):
    global _client, _client_model
    if _client is not None and _client_model == model:
        return _client
    if _client is not None:
        try:
            _client.close()
        except Exception:  # pragma: no cover - best effort
            pass
        _client = None
    import moondream as md  # heavy import, only when Parakeet is used

    if config.HF_TOKEN:
        os.environ["HF_TOKEN"] = config.HF_TOKEN
    logger.info("[Parakeet] Loading %s on %s", model, _device())
    _client = md.photon(model, device=_device())
    _client_model = model
    return _client


def transcribe(audio_path: str, model: str | None = None) -> str:
    """Plain-text transcription of a local audio file.

    Calls are serialized: one model instance already uses every core.
    """
    model = model or config.PARAKEET_MODEL
    with _lock:
        client = _get_client(model)
        result = client.transcribe(audio=audio_path)
    text = result.get("text") if isinstance(result, dict) else None
    return str(text or "").strip()


def clear_pool() -> None:
    """Release the loaded model (mainly for tests)."""
    global _client, _client_model
    with _lock:
        if _client is not None:
            try:
                _client.close()
            except Exception:  # pragma: no cover
                pass
        _client = None
        _client_model = None
