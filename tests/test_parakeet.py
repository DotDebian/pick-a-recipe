"""Parakeet speech to text: selection, model whitelist and Whisper fallback."""

import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault('DATA_DIR', tempfile.mkdtemp())
sys.modules.setdefault('faster_whisper', MagicMock())

from config import config, set_config_value  # noqa: E402
import parakeet_pool  # noqa: E402
from transcriber import Transcriber  # noqa: E402


def _transcriber():
    tr = Transcriber('/tmp/no-such-video.mp4')
    tr._extract_audio = MagicMock(return_value='/tmp/no-such-audio.wav')
    tr._load_model = MagicMock()
    tr.model = MagicMock()
    seg = MagicMock(text=' whisper text ')
    tr.model.transcribe.return_value = ([seg], MagicMock(language='fr'))
    return tr


class ParakeetTests(unittest.TestCase):
    def setUp(self):
        set_config_value('transcription_mode', 'parakeet')
        set_config_value('parakeet_model', 'moondream/parakeet-ultra')
        config.reload()

    def tearDown(self):
        set_config_value('transcription_mode', 'local')
        config.reload()

    def test_mode_and_model_are_accepted(self):
        self.assertEqual(config.TRANSCRIPTION_MODE, 'parakeet')
        self.assertEqual(config.PARAKEET_MODEL, 'moondream/parakeet-ultra')

    def test_unknown_model_falls_back_to_ultra(self):
        set_config_value('parakeet_model', 'someone/else')
        config.reload()
        self.assertEqual(config.PARAKEET_MODEL, 'moondream/parakeet-ultra')

    def test_parakeet_is_used(self):
        tr = _transcriber()
        with patch.object(parakeet_pool, 'transcribe', return_value='bonjour') as pk:
            self.assertEqual(tr.transcribe(), 'bonjour')
        pk.assert_called_once_with('/tmp/no-such-audio.wav')
        tr.model.transcribe.assert_not_called()

    def test_failure_falls_back_to_whisper(self):
        tr = _transcriber()
        with patch.object(parakeet_pool, 'transcribe', side_effect=RuntimeError('boom')):
            self.assertEqual(tr.transcribe(), 'whisper text')
        tr.model.transcribe.assert_called_once()

    def test_unsupported_spoken_language_uses_whisper(self):
        tr = _transcriber()
        with patch.object(parakeet_pool, 'transcribe') as pk:
            self.assertEqual(tr.transcribe(language='he'), 'whisper text')
        pk.assert_not_called()

    def test_supported_spoken_language_keeps_parakeet(self):
        tr = _transcriber()
        with patch.object(parakeet_pool, 'transcribe', return_value='hola') as pk:
            self.assertEqual(tr.transcribe(language='es'), 'hola')
        pk.assert_called_once()

    def test_pool_reuses_client_and_reads_text(self):
        fake = MagicMock()
        fake.transcribe.return_value = {'text': '  salut  '}
        md = MagicMock(photon=MagicMock(return_value=fake))
        parakeet_pool.clear_pool()
        with patch.dict(sys.modules, {'moondream': md}):
            self.assertEqual(parakeet_pool.transcribe('/a.wav'), 'salut')
            self.assertEqual(parakeet_pool.transcribe('/b.wav'), 'salut')
        md.photon.assert_called_once_with('moondream/parakeet-ultra', device='cpu')
        parakeet_pool.clear_pool()


if __name__ == '__main__':
    unittest.main()
