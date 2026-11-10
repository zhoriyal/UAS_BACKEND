const midtransClient = require('midtrans-client');
const { query } = require('../database');
const { logger } = require('../logger');
const { sendTicketNotification } = require('../emailService');

exports.createTransaction = async (req, res) => {
  const { bookingId } = req.body;
  if (typeof bookingId !== 'string' || !bookingId.trim()) {
    return res.status(400).json({
      success: false,
      message: 'bookingId wajib diisi',
    });
  }

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const clientKey = process.env.MIDTRANS_CLIENT_KEY;
  if (!serverKey || !clientKey) {
    logger.error('Konfigurasi Midtrans belum lengkap');
    return res.status(503).json({
      success: false,
      message: 'Layanan pembayaran belum tersedia',
    });
  }

  try {
    const [booking] = await query(
      'SELECT id, nama, email, phone, total_tiket, total_biaya, status FROM ticket_bookings WHERE id = ?',
      [bookingId.trim()],
    );
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Pemesanan tidak ditemukan',
      });
    }
    if (booking.status !== 'MENUNGGU') {
      return res.status(409).json({
        success: false,
        message: 'Pembayaran hanya tersedia untuk pemesanan yang menunggu pembayaran',
      });
    }

    const grossAmount = Number(booking.total_biaya);
    if (!Number.isSafeInteger(grossAmount) || grossAmount <= 0) {
      logger.error({ bookingId: booking.id }, 'Nominal pemesanan tidak valid');
      return res.status(400).json({
        success: false,
        message: 'Nominal pemesanan tidak valid',
      });
    }

    const snap = new midtransClient.Snap({
      isProduction: false,
      serverKey,
      clientKey,
    });
    const orderId = `MB-${booking.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const transaction = await snap.createTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      customer_details: {
        first_name: booking.nama,
        email: booking.email,
        ...(booking.phone ? { phone: booking.phone } : {}),
      },
      item_details: [
        {
          id: 'TICKET-MB',
          price: grossAmount,
          quantity: 1,
          name: `Tiket Museum Brawijaya (${booking.total_tiket} tiket)`,
        },
      ],
    });

    return res.status(200).json({
      success: true,
      message: 'Snap token berhasil dibuat',
      token: transaction.token,
      redirect_url: transaction.redirect_url,
    });
  } catch (error) {
    logger.error({ err: error, bookingId: bookingId.trim() }, 'Gagal membuat transaksi Midtrans');
    return res.status(500).json({
      success: false,
      message: 'Gagal membuat transaksi pembayaran',
    });
  }
};

exports.handleNotification = async (req, res) => {
  const notification = req.body;
  if (!notification || typeof notification.transaction_id !== 'string' || !notification.transaction_id.trim()) {
    return res.status(400).json({
      success: false,
      message: 'transaction_id wajib diisi',
    });
  }

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    logger.error('Konfigurasi Midtrans belum lengkap');
    return res.status(503).json({
      success: false,
      message: 'Layanan pembayaran belum tersedia',
    });
  }

  try {
    const coreApi = new midtransClient.CoreApi({
      isProduction: false,
      serverKey,
    });
    const transaction = await coreApi.transaction.notification(notification);
    const { order_id: orderId, transaction_status: transactionStatus, fraud_status: fraudStatus } = transaction;

    if (typeof orderId !== 'string' || !orderId.startsWith('MB-')) {
      logger.warn({ orderId }, 'Notifikasi Midtrans memiliki order_id yang tidak dikenal');
      return res.status(400).json({ success: false, message: 'order_id tidak valid' });
    }

    const bookingId = `#${orderId.slice('MB-'.length)}`;
    const [booking] = await query(
      'SELECT id, nama, email, total_tiket, total_biaya, visit_date, sesi, is_mancanegara, status FROM ticket_bookings WHERE id = ?',
      [bookingId],
    );
    if (!booking || `MB-${booking.id.replace(/[^A-Za-z0-9_-]/g, '-')}` !== orderId) {
      logger.warn({ orderId }, 'Booking untuk notifikasi Midtrans tidak ditemukan');
      return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
    }

    const grossAmount = Number(transaction.gross_amount);
    if (!Number.isSafeInteger(grossAmount) || grossAmount !== Number(booking.total_biaya)) {
      logger.error({ orderId, bookingId: booking.id }, 'Nominal notifikasi Midtrans tidak sesuai booking');
      return res.status(400).json({ success: false, message: 'Nominal transaksi tidak sesuai' });
    }

    let nextStatus = null;
    if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus === 'accept')) {
      nextStatus = 'LUNAS';
    } else if (transactionStatus === 'cancel' || transactionStatus === 'expire') {
      nextStatus = 'BATAL';
    }

    let statusChanged = false;
    if (nextStatus === 'LUNAS' && booking.status !== 'LUNAS') {
      const result = await query(
        "UPDATE ticket_bookings SET status = 'LUNAS', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'LUNAS'",
        [booking.id],
      );
      statusChanged = result.affectedRows > 0;
    } else if (nextStatus === 'BATAL' && booking.status === 'MENUNGGU') {
      const result = await query(
        "UPDATE ticket_bookings SET status = 'BATAL', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'MENUNGGU'",
        [booking.id],
      );
      statusChanged = result.affectedRows > 0;
    }

    if (statusChanged && nextStatus === 'LUNAS') {
      sendTicketNotification({
        to: booking.email,
        nama: booking.nama,
        bookingId: booking.id,
        totalTiket: booking.total_tiket,
        totalBiaya: booking.total_biaya,
        visitDate: booking.visit_date,
        sesi: booking.sesi,
        isMancanegara: Boolean(booking.is_mancanegara),
      }).then((result) => {
        if (!result.success) {
          logger.warn({ bookingId: booking.id }, 'Gagal mengirim email e-tiket setelah pembayaran');
        }
      }).catch((error) => {
        logger.error({ err: error, bookingId: booking.id }, 'Gagal mengirim email e-tiket setelah pembayaran');
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Notifikasi pembayaran berhasil diproses',
      orderId,
      transactionStatus,
      bookingStatus: statusChanged ? nextStatus : booking.status,
    });
  } catch (error) {
    logger.error({ err: error, transactionId: notification.transaction_id }, 'Gagal memverifikasi notifikasi Midtrans');
    return res.status(500).json({
      success: false,
      message: 'Gagal memverifikasi notifikasi pembayaran',
    });
  }
};