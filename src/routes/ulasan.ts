import { Router, Request, Response } from 'express';
import { ulasanModel } from '../models/ulasanModel';
import { asyncHandler } from '../database';
import authMiddleware from '../middleware/authMiddleware';
import requireRole from '../middleware/requireRole';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const rating = typeof req.query.rating === 'string' ? req.query.rating : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const pageNumber = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Number(req.query.limit) || 10);

    const { total, items, averageRating, overallTotal } = await ulasanModel.findPaginated({
      search,
      rating,
      status,
      page: pageNumber,
      limit: pageSize,
    });

    res.json({
      success: true,
      data: items,
      stats: {
        averageRating,
        total: overallTotal,
      },
      pagination: {
        total,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const item = await ulasanModel.findById(req.params.id);
    if (!item) {
      res.status(404).json({ success: false, message: 'Ulasan tidak ditemukan' });
      return;
    }
    res.json({ success: true, data: item });
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { nama, avatar_initial, avatar_color, rating, comment, category } = req.body;
    const reviewName = typeof nama === 'string' && nama.trim() ? nama.trim() : 'Pengunjung';
    if (!Number.isInteger(Number(rating)) || !comment) {
      res.status(400).json({ success: false, message: 'Rating dan komentar wajib diisi' });
      return;
    }
    const reviewRating = Number(rating);
    if (reviewRating < 1 || reviewRating > 5) {
      res.status(400).json({ success: false, message: 'Rating harus antara 1 dan 5' });
      return;
    }
    if (typeof comment !== 'string' || comment.trim().length < 5) {
      res.status(400).json({ success: false, message: 'Komentar minimal 5 karakter' });
      return;
    }

    const newUlasan = await ulasanModel.create({
      nama: reviewName,
      avatar_initial: typeof avatar_initial === 'string' ? avatar_initial : undefined,
      avatar_color: typeof avatar_color === 'string' ? avatar_color : undefined,
      category: typeof category === 'string' ? category : undefined,
      rating: reviewRating,
      comment: comment.trim(),
    });

    res.status(201).json({
      success: true,
      message: 'Ulasan berhasil dikirim. Terima kasih!',
      data: newUlasan,
    });
  }),
);

const saveReply = asyncHandler(async (req: Request, res: Response) => {
  const reply = req.body?.reply;
  if (typeof reply !== 'string' || reply.trim() === '') {
    res.status(400).json({ success: false, message: 'Balasan tidak boleh kosong' });
    return;
  }

  const ulasan = await ulasanModel.findById(req.params.id);
  if (!ulasan) {
    res.status(404).json({ success: false, message: 'Ulasan tidak ditemukan' });
    return;
  }

  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const replyDate = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  const updated = await ulasanModel.updateReply(req.params.id, reply.trim(), replyDate);

  res.json({ success: true, message: 'Balasan berhasil dikirim', data: updated });
});

router.post('/:id/reply', authMiddleware, requireRole(['ADMIN', 'SUPERADMIN', 'STAFF']), saveReply);
router.put('/:id/reply', authMiddleware, requireRole(['ADMIN', 'SUPERADMIN', 'STAFF']), saveReply);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const ulasan = await ulasanModel.findById(req.params.id);
    if (!ulasan) {
      res.status(404).json({ success: false, message: 'Ulasan tidak ditemukan' });
      return;
    }
    await ulasanModel.deleteById(req.params.id);
    res.json({ success: true, message: 'Ulasan berhasil dihapus' });
  }),
);

export default router;