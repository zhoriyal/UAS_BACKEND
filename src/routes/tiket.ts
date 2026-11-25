import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { tiketModel } from '../models/tiketModel';
import { sendTicketNotification } from '../emailService';

import authMiddleware from '../middleware/authMiddleware';
import requireRole from '../middleware/requireRole';

const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const adminOnly: RequestHandler = requireRole(['ADMIN', 'SUPERADMIN', 'STAFF']);

const getParamId = (id: string | string[] | undefined): string => {
  if (Array.isArray(id)) {
    return id[0] || '';
  }
  return id || '';
};

const router = Router();

router.get(
  '/categories',
  asyncHandler(async (_req: Request, res: Response) => {
    const categories = await tiketModel.getAllCategories();
    res.json({ success: true, data: categories });
  }),
);

router.get(
  '/categories/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = getParamId(req.params.id);
    const category = await tiketModel.findCategoryById(id);
    if (!category) {
      res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
      return;
    }
    res.json({ success: true, data: category });
  }),
);

router.post(
  '/categories',
  asyncHandler(async (req: Request, res: Response) => {
    const { badge, badge_bg, badge_color, title, price, kuota, status } = req.body;
    if (!badge || !title || price == null) {
      res.status(400).json({ success: false, message: 'badge, title, dan price wajib diisi' });
      return;
    }
    const newCategory = await tiketModel.createCategory({
      badge,
      badge_bg,
      badge_color,
      title,
      price,
      kuota,
      status,
    });
    res.status(201).json({ success: true, message: 'Kategori berhasil ditambahkan', data: newCategory });
  }),
);

router.put(
  '/categories/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = getParamId(req.params.id);
    const existing = await tiketModel.findCategoryById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
      return;
    }
    const { badge, badge_bg, badge_color, title, price, kuota, status } = req.body;
    const updated = await tiketModel.updateCategory(id, existing, {
      badge,
      badge_bg,
      badge_color,
      title,
      price,
      kuota,
      status,
    });
    res.json({ success: true, message: 'Kategori berhasil diperbarui', data: updated });
  }),
);

router.delete(
  '/categories/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = getParamId(req.params.id);
    const existing = await tiketModel.findCategoryById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
      return;
    }
    await tiketModel.deleteCategory(id);
    res.json({ success: true, message: 'Kategori berhasil dihapus' });
  }),
);

router.get(
  '/bookings',
  asyncHandler(async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const pageNumber = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Number(req.query.limit) || 10);

    const { total, bookings } = await tiketModel.findBookingsPaginated({
      status,
      search,
      page: pageNumber,
      limit: pageSize,
    });

    res.json({
      success: true,
      data: bookings,
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
  '/bookings/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = decodeURIComponent(getParamId(req.params.id));
    const booking = await tiketModel.findBookingByIdOrHash(id);
    if (!booking) {
      res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
      return;
    }
    res.json({ success: true, data: booking });
  }),
);

router.post(
  '/bookings',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      nama,
      email,
      phone,
      kategori_dewasa = 0,
      kategori_pelajar = 0,
      kategori_wna = 0,
      sesi,
      visit_date,
      payment_method = 'QRIS',
      is_mancanegara = 0,
    } = req.body;

    if (!nama || !email || !sesi || !visit_date) {
      res.status(400).json({ success: false, message: 'Nama, email, sesi, dan tanggal kunjungan wajib diisi' });
      return;
    }

    let finalIsMancanegara = Number(is_mancanegara);
    if (typeof phone === 'string' && phone.trim()) {
      const cleanPhone = phone.trim();
      if (!cleanPhone.startsWith('+62') && !cleanPhone.startsWith('08') && !cleanPhone.startsWith('62')) {
        finalIsMancanegara = 1;
      }
    }

    const categories = await tiketModel.getActiveCategoriesForPricing();
    const priceAdult =
      categories.find((c: { badge?: string; price?: number }) =>
        c.badge?.includes('UMUM') || c.badge?.includes('DEWASA'))?.price || 10000;
    const priceStudent =
      categories.find((c: { badge?: string; price?: number }) =>
        c.badge?.includes('PELAJAR'))?.price || 5000;
    const priceInternational =
      categories.find((c: { badge?: string; price?: number }) =>
        c.badge?.includes('MANCANEGARA'))?.price || 25000;

    const adultCount = Number(kategori_dewasa);
    const studentCount = Number(kategori_pelajar);
    const internationalCount = Number(kategori_wna);
    if (
      !Number.isSafeInteger(adultCount) || adultCount < 0
      || !Number.isSafeInteger(studentCount) || studentCount < 0
      || !Number.isSafeInteger(internationalCount) || internationalCount < 0
    ) {
      res.status(400).json({ success: false, message: 'Jumlah tiket harus berupa bilangan bulat non-negatif' });
      return;
    }
    const totalTickets = adultCount + studentCount + internationalCount;
    if (totalTickets <= 0) {
      res.status(400).json({ success: false, message: 'Pilih minimal 1 tiket' });
      return;
    }

    const totalCost =
      adultCount * priceAdult + studentCount * priceStudent + internationalCount * priceInternational;
    const dateString = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const bookingId = await tiketModel.generateBookingId(dateString);

    const newBooking = await tiketModel.createBooking({
      bookingId,
      nama,
      email,
      phone: typeof phone === 'string' ? phone : '',
      isMancanegara: finalIsMancanegara,
      adultCount,
      studentCount,
      internationalCount,
      totalTickets,
      totalCost,
      sesi,
      visitDate: visit_date,
      paymentMethod: payment_method,
    });

    res.status(201).json({ success: true, message: 'Pemesanan berhasil dibuat', data: newBooking });
  }),
);

router.put(
  ['/bookings/:id/status', '/bookings/status'],
  authMiddleware,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body;
    const rawId =
      getParamId(req.params.id)
      || (typeof req.body?.id === 'string' ? req.body.id : '')
      || (typeof req.query?.id === 'string' ? req.query.id : '');

    if (!['MENUNGGU', 'LUNAS', 'BATAL'].includes(status)) {
      res.status(400).json({ success: false, message: 'Status tidak valid' });
      return;
    }
    if (!rawId) {
      res.status(400).json({ success: false, message: 'ID pemesanan wajib diisi' });
      return;
    }

    const id = decodeURIComponent(rawId);
    const booking = await tiketModel.findBookingByIdOrHash(id);
    if (!booking) {
      res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
      return;
    }

    const updated = await tiketModel.updateBookingStatus(booking.id, status);

    if (status === 'LUNAS' && updated) {
      sendTicketNotification({
        to: updated.email,
        nama: updated.nama,
        bookingId: updated.id,
        totalTiket: updated.total_tiket,
        totalBiaya: updated.total_biaya,
        visitDate: updated.visit_date,
        sesi: updated.sesi,
        isMancanegara: Boolean(updated.is_mancanegara),
      }).catch((error: unknown) => console.error('Gagal memicu pengiriman email tiket:', error));
    }

    res.json({ success: true, message: 'Status berhasil diperbarui', data: updated });
  }),
);

router.put(
  '/bookings/:id/checkin',
  authMiddleware,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const id = decodeURIComponent(getParamId(req.params.id));
    const booking = await tiketModel.findBookingByIdOrHash(id);
    if (!booking) {
      res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
      return;
    }
    if (booking.status !== 'LUNAS') {
      res.status(400).json({ success: false, message: 'Tiket belum lunas, tidak dapat check-in' });
      return;
    }
    if (Number(booking.checked_in)) {
      res.status(409).json({ success: false, message: 'Tiket sudah check-in' });
      return;
    }

    const checkedIn = await tiketModel.checkInBooking(booking.id);
    if (!checkedIn) {
      res.status(409).json({ success: false, message: 'Status tiket berubah atau tiket sudah check-in' });
      return;
    }

    const updated = await tiketModel.findBookingById(booking.id);
    res.json({ success: true, message: 'Check-in berhasil', data: updated });
  }),
);

router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const today = new Date().toISOString().slice(0, 10);
    const [summary, weeklyData] = await Promise.all([
      tiketModel.getStatsSummary(today),
      tiketModel.getWeeklySales(),
    ]);

    const safeSummary: Record<string, unknown> =
      summary && typeof summary === 'object' ? (summary as Record<string, unknown>) : {};

    res.json({
      success: true,
      data: {
        ...safeSummary,
        weeklyData,
      },
    });
  }),
);

export default router;