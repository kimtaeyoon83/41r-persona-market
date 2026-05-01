// /api/benchmark — Phase 2-D.
//
// Per spec §6.6: per-category audience-fit averages across all
// completed scans. Hidden in the report until n>=3 (default; dev
// threshold — production will move to 50 once mainnet data
// accumulates). Two endpoints:
//
//   GET /api/benchmark/list      - all categories that meet threshold
//   GET /api/benchmark/:category - single category, null if n<3

import { Router, type Router as RouterType } from 'express';
import {
  getCategoryBenchmark,
  listCategoryBenchmarks,
} from '../services/benchmark.js';

const router: RouterType = Router();

router.get('/list', async (_req, res) => {
  const benchmarks = await listCategoryBenchmarks();
  res.json({ benchmarks });
});

router.get('/:category', async (req, res) => {
  const benchmark = await getCategoryBenchmark(req.params.category);
  res.json({ benchmark });
});

export default router;
