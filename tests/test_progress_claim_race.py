"""A queue-position broadcast must not undo a worker's claim on the job."""

import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'ui'))
os.environ.setdefault('DATA_DIR', tempfile.mkdtemp())


class TestProgressClaimRace(unittest.TestCase):
    def test_guarded_write_skips_when_status_moved(self):
        from database import create_job, get_db, get_job, update_job_progress
        job_id = create_job('https://example.com/race')
        with get_db() as conn:
            conn.execute("UPDATE recipe_jobs SET status = 'running' WHERE id = ?", (job_id,))
            conn.commit()
        ok = update_job_progress(job_id, 'queued', 0, 'queued', 'Queued',
                                 expected_status='queued')
        self.assertFalse(ok)
        self.assertEqual(get_job(job_id)['status'], 'running')

    def test_broadcast_racing_claim_keeps_job_running(self):
        import database
        import job_manager as jm
        job_id = database.create_job('https://example.com/race2')
        stale = dict(database.get_job(job_id))  # what the broadcast read: queued

        claimed = []

        def claim_then_return_stale(jid, *a, **kw):
            # The worker claims the job right after the broadcast's first read.
            if claimed:
                return database.get_job(jid)
            claimed.append(True)
            with database.get_db() as conn:
                conn.execute("UPDATE recipe_jobs SET status = 'running' WHERE id = ?", (jid,))
                conn.commit()
            return stale

        manager = jm.JobManager.__new__(jm.JobManager)
        manager._lock = __import__('threading').Lock()
        manager.active_jobs = {}
        manager.cancellation_flags = {}
        manager.socketio = mock.MagicMock()
        with mock.patch.object(jm, 'get_job', side_effect=claim_then_return_stale), \
                mock.patch.object(manager, 'is_cancelled', return_value=False), \
                mock.patch.object(jm, 'socketio', create=True):
            manager.update_progress(job_id, 'queued', 'Queued — position 1', 0)
        self.assertEqual(database.get_job(job_id)['status'], 'running')


if __name__ == '__main__':
    unittest.main()
