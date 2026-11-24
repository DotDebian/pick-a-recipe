"""A re-run that reuses cached frames keeps the frame the model picked.

It used to fall back to candidate 0, the first frame of the video (a foil-
covered tray, a presenter holding herbs) instead of the plated dish.
"""

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault('DATA_DIR', tempfile.mkdtemp())

import image_extractor as ie  # noqa: E402


def _dish_dir(n=12):
    d = tempfile.mkdtemp()
    frames = os.path.join(d, 'dish_frames')
    os.makedirs(frames)
    for i in range(n):
        open(os.path.join(frames, f'dish_candidate_{i:02d}.jpg'), 'wb').close()
    open(os.path.join(d, 'dish.jpg'), 'wb').close()
    return d


class CachedFrameChoiceTests(unittest.TestCase):
    def test_saved_choice_is_reused_without_asking_again(self):
        d = _dish_dir()
        ie.save_best_index(os.path.join(d, 'dish_frames'), 10)
        with patch.object(ie, 'select_best_frame') as sel:
            got = ie.cached_candidates(d)
        sel.assert_not_called()
        self.assertEqual(got['best_index'], 10)
        self.assertEqual(len(got['candidates']), 12)

    def test_old_cache_without_choice_reselects_instead_of_frame_zero(self):
        d = _dish_dir()
        with patch.object(ie, 'select_best_frame', return_value=9) as sel, \
                patch.object(ie.ImageExtractor, '_enhance_frame') as enhance:
            got = ie.cached_candidates(d)
        sel.assert_called_once()
        enhance.assert_called_once()
        self.assertEqual(got['best_index'], 9)
        # ...and is remembered for the next run.
        self.assertEqual(ie.load_best_index(os.path.join(d, 'dish_frames'), 12), 9)

    def test_failed_reselection_prefers_last_frame(self):
        d = _dish_dir()
        with patch.object(ie, 'select_best_frame', return_value=None), \
                patch.object(ie.ImageExtractor, '_enhance_frame'):
            self.assertEqual(ie.cached_candidates(d)['best_index'], 11)

    def test_out_of_range_saved_index_is_ignored(self):
        d = _dish_dir(4)
        ie.save_best_index(os.path.join(d, 'dish_frames'), 7)
        self.assertIsNone(ie.load_best_index(os.path.join(d, 'dish_frames'), 4))

    def test_no_cache(self):
        self.assertIsNone(ie.cached_candidates(tempfile.mkdtemp()))


if __name__ == '__main__':
    unittest.main()
