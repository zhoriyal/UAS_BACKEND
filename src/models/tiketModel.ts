import { query } from '../database';

const CATEGORY_FIELDS =
  'id, badge, badge_bg, badge_color, title, price, kuota, status, created_at, updated_at';

const BOOKING_FIELDS =
  'id, nama, email, phone, is_mancanegara, kategori_dewasa, kategori_pelajar, kategori_wna, total_tiket, total_biaya, sesi, visit_date, payment_method, status, checked_in, checked_in_at, created_at, updated_at';

export const tiketModel = {
  async getAllCategories() {
    return query(`SELECT ${CATEGORY_FIELDS} FROM ticket_categories ORDER BY id ASC`);
  },

  async findCategoryById(id: string | number) {
    const [category] = await query(
      `SELECT ${CATEGORY_FIELDS} FROM ticket_categories WHERE id = ?`,
      [id],
    );
    return category;
  },

  async createCategory(payload: {
    badge: string;
    badge_bg?: string;
    badge_color?: string;
    title: string;
    price: number | string;
    kuota?: number | string;
    status?: string;
  }) {
    const result = await query(
      `INSERT INTO ticket_categories (badge, badge_bg, badge_color, title, price, kuota, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        payload.badge,
        payload.badge_bg || '#fef3c7',
        payload.badge_color || '#92400e',
        payload.title,
        payload.price,
        payload.kuota ?? 500,
        payload.status || 'Aktif',
      ],
    );
    return this.findCategoryById(result.insertId);
  },

  async updateCategory(
    id: string | number,
    existing: Record<string, unknown>,
    payload: {
      badge?: string;
      badge_bg?: string;
      badge_color?: string;
      title?: string;
      price?: number | string;
      kuota?: number | string;
      status?: string;
    },
  ) {
    await query(
      `UPDATE ticket_categories
       SET badge = ?, badge_bg = ?, badge_color = ?, title = ?, price = ?, kuota = ?, status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.badge || existing.badge,
        payload.badge_bg || existing.badge_bg,
        payload.badge_color || existing.badge_color,
        payload.title || existing.title,
        payload.price ?? existing.price,
        payload.kuota ?? existing.kuota,
        payload.status || existing.status,
        id,
      ],
    );
    return this.findCategoryById(id);
  },

  async deleteCategory(id: string | number) {
    return query('DELETE FROM ticket_categories WHERE id = ?', [id]);
  },

  async findBookingsPaginated({
    status,
    search,
    page,
    limit,
  }: {
    status?: string;
    search?: string;
    page: number;
    limit: number;
  }) {
    let where = ' FROM ticket_bookings WHERE 1=1';
    const params: unknown[] = [];

    if (status && status !== 'ALL') {
      where += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      where += ' AND (id LIKE ? OR nama LIKE ? OR email LIKE ?)';
      const value = `%${search}%`;
      params.push(value, value, value);
    }

    const safePage = Math.max(1, Math.trunc(Number(page) || 1));
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 10)));
    const safeOffset = (safePage - 1) * safeLimit;

    const [{ total }] = await query(`SELECT COUNT(*) AS total${where}`, params);
    const bookings = await query(
      `SELECT ${BOOKING_FIELDS}${where} ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );

    return {
      total: Number(total ?? 0),
      bookings: bookings || [],
    };
  },

  async findBookingById(id: string) {
    const [booking] = await query(
      `SELECT ${BOOKING_FIELDS} FROM ticket_bookings WHERE id = ?`,
      [id],
    );
    return booking;
  },

  async findBookingByIdOrHash(id: string) {
    let [booking] = await query(
      `SELECT ${BOOKING_FIELDS} FROM ticket_bookings WHERE id = ?`,
      [id],
    );
    if (!booking && !id.startsWith('#')) {
      [booking] = await query(
        `SELECT ${BOOKING_FIELDS} FROM ticket_bookings WHERE id = ?`,
        [`#${id}`],
      );
    }
    return booking;
  },

  async getActiveCategoriesForPricing() {
    return query(
      'SELECT id, badge, price FROM ticket_categories WHERE status = ?',
      ['Aktif'],
    );
  },

  async generateBookingId(dateString: string): Promise<string> {
    const rows = await query<Array<{ id: string }>>(
      'SELECT id FROM ticket_bookings WHERE id LIKE ?',
      [`#MB-${dateString}-%`],
    );
    let maxSeq = 0;
    for (const row of rows || []) {
      const match = typeof row?.id === 'string' ? row.id.match(/-(\d+)$/) : null;
      if (match) {
        const num = Number.parseInt(match[1], 10);
        if (Number.isFinite(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    }
    const sequence = String(maxSeq + 1).padStart(2, '0');
    return `#MB-${dateString}-${sequence}`;
  },

  async createBooking(payload: {
    bookingId: string;
    nama: string;
    email: string;
    phone: string;
    isMancanegara: number;
    adultCount: number;
    studentCount: number;
    internationalCount: number;
    totalTickets: number;
    totalCost: number;
    sesi: string;
    visitDate: string;
    paymentMethod: string;
  }) {
    await query(
      `INSERT INTO ticket_bookings
        (id, nama, email, phone, is_mancanegara, kategori_dewasa, kategori_pelajar, kategori_wna,
         total_tiket, total_biaya, sesi, visit_date, payment_method, status, checked_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MENUNGGU', 0, NOW(), NOW())`,
      [
        payload.bookingId,
        payload.nama,
        payload.email,
        payload.phone,
        payload.isMancanegara,
        payload.adultCount,
        payload.studentCount,
        payload.internationalCount,
        payload.totalTickets,
        payload.totalCost,
        payload.sesi,
        payload.visitDate,
        payload.paymentMethod,
      ],
    );
    return this.findBookingById(payload.bookingId);
  },

  async updateBookingStatus(id: string, status: string) {
    await query(
      'UPDATE ticket_bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, id],
    );
    return this.findBookingById(id);
  },

  async checkInBooking(id: string): Promise<boolean> {
    const result = await query(
      `UPDATE ticket_bookings
       SET checked_in = 1, checked_in_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'LUNAS' AND checked_in = 0`,
      [id],
    );
    return result?.affectedRows === 1;
  },

  async getStatsSummary(todayDateString: string) {
    const [
      [totalSold],
      [totalRevenue],
      [soldToday],
      [revenueToday],
      [checkedIn],
      [pending],
    ] = await Promise.all([
      query("SELECT COALESCE(SUM(total_tiket), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS'"),
      query("SELECT COALESCE(SUM(total_biaya), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS'"),
      query(
        "SELECT COALESCE(SUM(total_tiket), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?",
        [todayDateString],
      ),
      query(
        "SELECT COALESCE(SUM(total_biaya), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?",
        [todayDateString],
      ),
      query(
        'SELECT COALESCE(SUM(total_tiket), 0) AS value FROM ticket_bookings WHERE checked_in = 1 AND DATE(created_at) = ?',
        [todayDateString],
      ),
      query("SELECT COUNT(*) AS total FROM ticket_bookings WHERE status = 'MENUNGGU'"),
    ]);

    return {
      totalTerjual: Number(totalSold?.value ?? 0),
      totalPendapatan: Number(totalRevenue?.value ?? 0),
      terjualHariIni: Number(soldToday?.value ?? 0),
      pendapatanHariIni: Number(revenueToday?.value ?? 0),
      sudahCheckIn: Number(checkedIn?.value ?? 0),
      menunggu: Number(pending?.total ?? 0),
    };
  },

  async getWeeklySales() {
    const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const weeklyData: Array<{ day: string; val: number; date: string }> = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateString = date.toISOString().slice(0, 10);
      const [row] = await query(
        `SELECT COALESCE(SUM(total_tiket), 0) AS value
         FROM ticket_bookings
         WHERE status = 'LUNAS' AND DATE(created_at) = ?`,
        [dateString],
      );

      weeklyData.push({
        day: days[date.getDay()],
        val: Number(row?.value ?? 0),
        date: dateString,
      });
    }

    return weeklyData;
  },
};