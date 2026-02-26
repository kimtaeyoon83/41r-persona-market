import { Router, type Router as RouterType } from 'express';
import { startAutoTest, getAutoTestStatus } from '../services/autotest.js';

const router: RouterType = Router();

// POST /api/autotest/run — Start an auto test job
router.post('/run', async (req, res) => {
  try {
    const { test_id, persona_id } = req.body;

    if (!test_id || !persona_id) {
      res.status(400).json({ error: 'test_id and persona_id are required' });
      return;
    }

    const job = await startAutoTest(test_id, persona_id);
    res.json({
      job_id: job.id,
      status: job.status,
      message: 'Auto test started. Poll /api/autotest/status/:jobId for updates.',
    });
  } catch (error) {
    console.error('[POST /api/autotest/run]', error);
    res.status(500).json({ error: 'Failed to start auto test' });
  }
});

// GET /api/autotest/status/:jobId — Get job status
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = getAutoTestStatus(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      report_id: job.reportId,
      error: job.error,
      result: job.status === 'completed' ? job.result : undefined,
    });
  } catch (error) {
    console.error('[GET /api/autotest/status]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
