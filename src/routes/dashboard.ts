import { Router, Request, Response } from 'express';
import { dashboardModel } from '../models/dashboardModel';
import { asyncHandler } from '../database';

const router = Router();

router.get(
  '/summary',
  asyncHandler(async (_req: Request, res: Response) => {
    const today = new Date().toISOString().slice(0, 10);
    const [summary, weeklyData] = await Promise.all([
      dashboardModel.getSummaryMetrics(today),
      dashboardModel.getWeeklyTicketSales(),
    ]);

    res.json({
      success: true,
      data: {
        ...summary,
        weeklyData,
      },
    });
  }),
);

export default router;