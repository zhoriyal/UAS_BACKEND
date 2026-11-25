import { query } from '../database';

export const dashboardModel = {
  async getSummaryMetrics(todayDateString: string) {
    const [[sales], [revenue], [collection], transactions, reviews, [reviewCount], pending] =
      await Promise.all([
        query(
          "SELECT COALESCE(SUM(total_tiket), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?",
          [todayDateString],
        ),
        query(
          "SELECT COALESCE(SUM(total_biaya), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?",
          [todayDateString],
        ),
        query('SELECT COUNT(*) AS total FROM koleksi'),
        query(
          `SELECT id, nama AS name, total_tiket AS tickets, total_biaya AS total, status,
                  DATE(created_at) AS date
           FROM ticket_bookings ORDER BY created_at DESC LIMIT 5`,
        ),
        query(
          `SELECT id, nama AS user, rating, comment, created_at AS date
           FROM ulasan ORDER BY created_at DESC LIMIT 2`,
        ),
        query("SELECT COUNT(*) AS total FROM ulasan WHERE reply = '' OR reply IS NULL"),
        query(
          `SELECT id, nama, total_tiket FROM ticket_bookings
           WHERE status = 'MENUNGGU' ORDER BY created_at DESC LIMIT 5`,
        ),
      ]);

    return {
      terjualHariIni: Number(sales?.value ?? 0),
      pendapatanHariIni: Number(revenue?.value ?? 0),
      totalKoleksi: Number(collection?.total ?? 0),
      transactions: transactions || [],
      reviews: reviews || [],
      ulasanBelumDibalas: Number(reviewCount?.total ?? 0),
      pendingBookings: pending || [],
    };
  },

  async getWeeklyTicketSales() {
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