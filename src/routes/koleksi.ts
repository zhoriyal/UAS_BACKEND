import { Router, Request, Response } from 'express';
import { koleksiModel } from '../models/koleksiModel';
import { asyncHandler } from '../database';

const router = Router();

function validateKoleksiFields(fields: {
  nama?: unknown;
  sub_deskripsi?: unknown;
  tahun?: unknown;
}): string | null {
  const lettersOnly = /^[A-Za-z\s]+$/;
  const numbersOnly = /^[0-9]+$/;

  if (fields.nama !== undefined) {
    const nama = String(fields.nama).trim();
    if (nama && !lettersOnly.test(nama)) {
      return 'Nama koleksi hanya boleh menggunakan huruf saja';
    }
  }
  if (fields.sub_deskripsi !== undefined) {
    const sub = String(fields.sub_deskripsi ?? '').trim();
    if (sub && !lettersOnly.test(sub)) {
      return 'Keterangan singkat hanya boleh menggunakan huruf saja';
    }
  }
  if (fields.tahun !== undefined) {
    const tahun = String(fields.tahun ?? '').trim();
    if (tahun && !numbersOnly.test(tahun)) {
      return 'Tahun / era hanya boleh menggunakan angka saja';
    }
  }
  return null;
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const kategori = typeof req.query.kategori === 'string' ? req.query.kategori : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const pageNumber = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Number(req.query.limit) || 10);

    const [{ total, items }, stats] = await Promise.all([
      koleksiModel.findPaginated({
        search,
        kategori,
        status,
        page: pageNumber,
        limit: pageSize,
      }),
      koleksiModel.getStats(),
    ]);

    res.json({
      success: true,
      data: items,
      stats,
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
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await koleksiModel.getStats();
    res.json({ success: true, data: stats });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const item = await koleksiModel.findById(req.params.id);
    if (!item) {
      res.status(404).json({ success: false, message: 'Koleksi tidak ditemukan' });
      return;
    }
    res.json({ success: true, data: item });
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      nama,
      sub_deskripsi,
      deskripsi_lengkap,
      kategori,
      tahun,
      lokasi,
      status,
      image_url,
    } = req.body;

    if (!nama || !kategori) {
      res.status(400).json({ success: false, message: 'Nama koleksi dan kategori wajib diisi' });
      return;
    }

    const fieldError = validateKoleksiFields({ nama, sub_deskripsi, tahun });
    if (fieldError) {
      res.status(400).json({ success: false, message: fieldError });
      return;
    }

    const newItem = await koleksiModel.create({
      nama,
      sub_deskripsi,
      deskripsi_lengkap,
      kategori,
      tahun,
      lokasi,
      status,
      image_url,
    });

    res.status(201).json({ success: true, message: 'Koleksi berhasil ditambahkan', data: newItem });
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await koleksiModel.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Koleksi tidak ditemukan' });
      return;
    }

    const {
      nama,
      sub_deskripsi,
      deskripsi_lengkap,
      kategori,
      tahun,
      lokasi,
      status,
      image_url,
    } = req.body;

    const fieldError = validateKoleksiFields({ nama, sub_deskripsi, tahun });
    if (fieldError) {
      res.status(400).json({ success: false, message: fieldError });
      return;
    }

    const updated = await koleksiModel.updateById(req.params.id, existing, {
      nama,
      sub_deskripsi,
      deskripsi_lengkap,
      kategori,
      tahun,
      lokasi,
      status,
      image_url,
    });

    res.json({ success: true, message: 'Koleksi berhasil diperbarui', data: updated });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await koleksiModel.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Koleksi tidak ditemukan' });
      return;
    }

    await koleksiModel.deleteById(req.params.id);
    res.json({ success: true, message: 'Koleksi berhasil dihapus' });
  }),
);

export default router;