import { query, pool } from '../database';

export interface BookingPaymentData {
  id: string;
  nama: string;
  email: string;
  phone: string | null;
  total_tiket: number;
  total_biaya: number;
  visit_date?: string;
  sesi?: string;
  payment_method?: string;
  is_mancanegara?: number;
  status: string;
}

export interface ExistingTicketData {
  id: string;
  order_id: string;
  status: string;
  payment_method: string;
  snap_token?: string | null;
}

export interface TicketWithBookingData {
  id: string;
  booking_id: string;
  order_id: string;
  amount: number;
  status: string;
  nama: string;
  email: string;
  visit_date: string;
  sesi: string;
  total_tiket: number;
  is_mancanegara: number;
}

export const paymentModel = {
  async findBookingById(bookingId: string): Promise<BookingPaymentData | null> {
    const [booking] = await query<BookingPaymentData[]>(
      `SELECT * FROM ticket_bookings WHERE id = ?`,
      [bookingId],
    );
    return booking || null;
  },

  async findBookingByIdOrHash(bookingId: string): Promise<BookingPaymentData | null> {
    const trimmed = bookingId.trim();
    if (!trimmed) return null;
    const direct = await this.findBookingById(trimmed);
    if (direct) return direct;
    if (!trimmed.startsWith('#')) {
      return this.findBookingById(`#${trimmed}`);
    }
    return this.findBookingById(trimmed.slice(1));
  },

  async findUserByEmail(email: string): Promise<{ id: number } | null> {
    const [user] = await query<{ id: number }[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    return user || null;
  },

  async findExistingTicketByBookingId(bookingId: string): Promise<ExistingTicketData | null> {
    const [ticket] = await query<ExistingTicketData[]>(
      `SELECT t.id, t.order_id, t.status, t.payment_method, tr.snap_token
       FROM tickets t
       LEFT JOIN transactions tr ON tr.ticket_id = t.id
       WHERE t.booking_id = ?`,
      [bookingId],
    );
    return ticket || null;
  },

  async findTicketByOrderId(orderId: string): Promise<TicketWithBookingData | null> {
    const [ticket] = await query<TicketWithBookingData[]>(
      `SELECT t.id, t.booking_id, t.order_id, t.amount, t.status,
              b.nama, b.email, b.visit_date, b.sesi, b.total_tiket, b.is_mancanegara
       FROM tickets t
       INNER JOIN ticket_bookings b ON b.id = t.booking_id
       WHERE t.order_id = ?`,
      [orderId],
    );
    return ticket || null;
  },

  async updateBookingPaymentMethod(bookingId: string, paymentMethod: string): Promise<void> {
    await query(
      'UPDATE ticket_bookings SET payment_method = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [paymentMethod, bookingId],
    );
  },

  async updateBookingStatus(bookingId: string, status: string): Promise<void> {
    await query(
      'UPDATE ticket_bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, bookingId],
    );
  },

  async updateTicketStatus(ticketId: string, status: string, pdfUrl?: string | null): Promise<void> {
    await query(
      `UPDATE tickets
       SET status = ?, pdf_url = COALESCE(?, pdf_url)
       WHERE id = ?`,
      [status, pdfUrl || null, ticketId],
    );
  },

  async updateTransactionStatus(
    ticketId: string,
    status: 'PENDING' | 'SUCCESS' | 'FAILED',
    providerTransactionId?: string | null,
  ): Promise<void> {
    await query(
      `UPDATE transactions
       SET status = ?, provider_transaction_id = COALESCE(?, provider_transaction_id)
       WHERE ticket_id = ?`,
      [status, providerTransactionId || null, ticketId],
    );
  },

  async createTicketAndTransaction(params: {
    ticketId: string;
    bookingId: string;
    orderId: string;
    userId: number | null;
    userName: string;
    amount: number;
    paymentMethod: string;
    transactionId: string;
    paymentType: string;
    snapToken: string;
  }): Promise<void> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(
        `INSERT INTO tickets
          (id, booking_id, order_id, user_id, user_name, amount, payment_method, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW())`,
        [
          params.ticketId,
          params.bookingId,
          params.orderId,
          params.userId,
          params.userName,
          params.amount,
          params.paymentMethod,
        ],
      );

      await connection.execute(
        `INSERT INTO transactions
          (id, ticket_id, order_id, amount, payment_method, status, snap_token, created_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?, NOW())`,
        [
          params.transactionId,
          params.ticketId,
          params.orderId,
          params.amount,
          params.paymentType,
          params.snapToken,
        ],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
