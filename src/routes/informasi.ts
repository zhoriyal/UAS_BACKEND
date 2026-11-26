import { Router, Request, Response } from 'express';
import { informasiModel } from '../models/informasiModel';
import { asyncHandler } from '../database';

const router = Router();

// Rute root alias untuk pengumuman
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const rows = await informasiModel.getAllPengumuman(status);
    res.json({ success: true, data: rows });
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { title, description, category, date, status } = req.body;
    if (!title || !category || !date) {
      res.status(400).json({ success: false, message: 'Judul, kategori, dan tanggal wajib diisi' });
      return;
    }

    const created = await informasiModel.createPengumuman({
      title,
      description,
      category,
      date,
      status,
    });
    res.status(201).json({ success: true, message: 'Pengumuman berhasil ditambahkan', data: created });
  }),
);

router.get(
  '/pengumuman',
  asyncHandler(async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const rows = await informasiModel.getAllPengumuman(status);
    res.json({ success: true, data: rows });
  }),
);

router.post(
  '/pengumuman',
  asyncHandler(async (req: Request, res: Response) => {
    const { title, description, category, date, status } = req.body;
    if (!title || !category || !date) {
      res.status(400).json({ success: false, message: 'Judul, kategori, dan tanggal wajib diisi' });
      return;
    }

    const created = await informasiModel.createPengumuman({
      title,
      description,
      category,
      date,
      status,
    });
    res.status(201).json({ success: true, message: 'Pengumuman berhasil ditambahkan', data: created });
  }),
);

router.put(
  '/pengumuman/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await informasiModel.findPengumumanById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan' });
      return;
    }

    const { title, description, category, date, status } = req.body;
    const updated = await informasiModel.updatePengumuman(req.params.id, {
      title: title || existing.title,
      description: description ?? existing.description,
      category: category || existing.category,
      date: date || existing.date,
      status: status || existing.status,
    });
    res.json({ success: true, message: 'Pengumuman berhasil diperbarui', data: updated });
  }),
);

router.delete(
  '/pengumuman/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await informasiModel.findPengumumanById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan' });
      return;
    }

    await informasiModel.deletePengumuman(req.params.id);
    res.json({ success: true, message: 'Pengumuman berhasil dihapus' });
  }),
);

router.get(
  '/faq',
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await informasiModel.getAllFaq();
    res.json({ success: true, data: rows });
  }),
);

router.post(
  '/faq',
  asyncHandler(async (req: Request, res: Response) => {
    const { question, answer } = req.body;
    if (!question || !answer) {
      res.status(400).json({ success: false, message: 'Pertanyaan dan jawaban wajib diisi' });
      return;
    }

    const created = await informasiModel.createFaq(question, answer);
    res.status(201).json({ success: true, message: 'FAQ berhasil ditambahkan', data: created });
  }),
);

router.put(
  '/faq/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await informasiModel.findFaqById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'FAQ tidak ditemukan' });
      return;
    }

    const { question, answer } = req.body;
    const updated = await informasiModel.updateFaq(
      req.params.id,
      question || existing.question,
      answer || existing.answer,
    );
    res.json({ success: true, message: 'FAQ berhasil diperbarui', data: updated });
  }),
);

router.delete(
  '/faq/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await informasiModel.findFaqById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'FAQ tidak ditemukan' });
      return;
    }

    await informasiModel.deleteFaq(req.params.id);
    res.json({ success: true, message: 'FAQ berhasil dihapus' });
  }),
);

router.get(
  '/jam-operasional',
  asyncHandler(async (_req: Request, res: Response) => {
    const hours = await informasiModel.getJamOperasional();
    res.json({ success: true, data: hours || null });
  }),
);

router.put(
  '/jam-operasional',
  asyncHandler(async (req: Request, res: Response) => {
    const { hari, jam, telepon } = req.body;
    const updated = await informasiModel.upsertJamOperasional({ hari, jam, telepon });
    res.json({ success: true, message: 'Jam operasional berhasil diperbarui', data: updated });
  }),
);

// Rute alias untuk update dan delete pengumuman lewat /api/informasi/:id
router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await informasiModel.findPengumumanById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan' });
      return;
    }

    const { title, description, category, date, status } = req.body;
    const updated = await informasiModel.updatePengumuman(req.params.id, {
      title: title || existing.title,
      description: description ?? existing.description,
      category: category || existing.category,
      date: date || existing.date,
      status: status || existing.status,
    });
    res.json({ success: true, message: 'Pengumuman berhasil diperbarui', data: updated });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await informasiModel.findPengumumanById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan' });
      return;
    }

    await informasiModel.deletePengumuman(req.params.id);
    res.json({ success: true, message: 'Pengumuman berhasil dihapus' });
  }),
);

export default router;