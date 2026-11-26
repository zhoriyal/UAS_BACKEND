import { Router, Request, Response } from 'express';
import { asyncHandler } from '../database';
import { notifikasiModel } from '../models/notifikasiModel';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { items, unread } = await notifikasiModel.list(Number(req.query.limit) || 30);
    res.json({ success: true, data: items, unread });
  }),
);

router.put(
  '/read-all',
  asyncHandler(async (_req: Request, res: Response) => {
    await notifikasiModel.markAllRead();
    res.json({ success: true, message: 'Semua notifikasi ditandai sudah dibaca' });
  }),
);

router.put(
  '/:id/read',
  asyncHandler(async (req: Request, res: Response) => {
    await notifikasiModel.markRead(String(req.params.id));
    res.json({ success: true, message: 'Notifikasi ditandai sudah dibaca' });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await notifikasiModel.remove(String(req.params.id));
    res.json({ success: true, message: 'Notifikasi dihapus' });
  }),
);

export default router;

