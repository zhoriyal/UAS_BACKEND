const midtransClient = require('midtrans-client');
const { query } = require('../database');
const { logger } = require('../logger');
const { sendTicketNotification } = require('../emailService');

function getOrderId(bookingId) {
  return `MB-${bookingId.replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function isOrderIdForBooking(bookingId, orderId) {
  const legacyOrderId = `MB-${bookingId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  return getOrderId(bookingId) === orderId || legacyOrderId === orderId;
}

exports.createTransaction = async (req, res) => {
  const { bookingId } = req.body;
  if (typeof bookingId !== 'string' || !bookingId.trim()) {
    return res.status(400).json({
      success: false,
      message: 'bookingId wajib diisi',
    });
  }

  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim() || '';
  const clientKey = process.env.MIDTRANS_CLIENT_KEY?.trim() || '';
  const serverKeyPrefix = isProduction ? 'Mid-server-' : 'SB-Mid-server-';
  const clientKeyPrefix = isProduction ? 'Mid-client-' : 'SB-Mid-client-';
  if (!serverKey.startsWith(serverKeyPrefix) || !clientKey.startsWith(clientKeyPrefix)) {
    logger.error({ isProduction }, 'Key Midtrans tidak lengkap atau tidak sesuai dengan mode yang dipilih');
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
      isProduction,
      serverKey,
      clientKey,
    });
    const orderId = getOrderId(booking.id);
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

    // --- TAMBAHAN: SIMPAN / CATAT KE TABEL TRANSACTIONS DI PHPMYADMIN ---
    await query(
      `INSERT INTO transactions (ticket_id, order_id, amount, payment_method, status, snap_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE snap_token = ?, status = 'pending', created_at = NOW()`,
      [booking.id, orderId, grossAmount, 'QRIS / Transfer', 'pending', transaction.token, transaction.token]
    ).catch((err) => {
      logger.warn({ err, orderId }, 'Gagal mencatat transaksi awal ke database');
    });
    // -----------------------------------------------------------------

    return res.status(200).json({
      success: true,
      message: 'Snap token berhasil dibuat',
      token: transaction.token,
      redirect_url: transaction.redirect_url,
    });
  } catch (error) {
    const apiResponse = error && typeof error === 'object' ? error.ApiResponse : undefined;
    logger.error({
      err: error,
      message: error instanceof Error ? error.message : String(error),
      statusCode: error && typeof error === 'object'
        ? error.httpStatusCode || error.statusCode || apiResponse?.status_code
        : undefined,
      midtransResponse: apiResponse,
      bookingId: bookingId.trim(),
    }, 'Gagal membuat transaksi Midtrans');
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

  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim() || '';
  const serverKeyPrefix = isProduction ? 'Mid-server-' : 'SB-Mid-server-';
  if (!serverKey.startsWith(serverKeyPrefix)) {
    logger.error({ isProduction }, 'Server key Midtrans tidak lengkap atau tidak sesuai dengan mode yang dipilih');
    return res.status(503).json({
      success: false,
      message: 'Layanan pembayaran belum tersedia',
    });
  }

  try {
    const coreApi = new midtransClient.CoreApi({
      isProduction,
      serverKey,
    });
    const transaction = await coreApi.transaction.notification(notification);
    const {
      order_id: orderId,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
      payment_type: paymentType,
      transaction_id: transactionId
    } = transaction;

    if (typeof orderId !== 'string' || !orderId.startsWith('MB-')) {
      logger.warn({ orderId }, 'Notifikasi Midtrans memiliki order_id yang tidak dikenal');
      return res.status(400).json({ success: false, message: 'order_id tidak valid' });
    }

    const bookingSuffix = orderId.slice('MB-'.length).replace(/^-/, '');
    const bookingId = `#${bookingSuffix}`;
    const [booking] = await query(
      'SELECT id, nama, email, total_tiket, total_biaya, visit_date, sesi, is_mancanegara, status FROM ticket_bookings WHERE id = ?',
      [bookingId],
    );
    if (!booking || !isOrderIdForBooking(booking.id, orderId)) {
      logger.warn({ orderId }, 'Booking untuk notifikasi Midtrans tidak ditemukan');
      return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
    }

    const grossAmount = Number(transaction.gross_amount);
    if (!Number.isSafeInteger(grossAmount) || grossAmount !== Number(booking.total_biaya)) {
      logger.error({ orderId, bookingId: booking.id }, 'Nominal notifikasi Midtrans tidak sesuai booking');
      return res.status(400).json({ success: false, message: 'Nominal transaksi tidak sesuai' });
    }

    let nextStatus = null;
    let dbStatusTransaction = 'pending';
    if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus === 'accept')) {
      nextStatus = 'LUNAS';
      dbStatusTransaction = 'success';
    } else if (transactionStatus === 'cancel' || transactionStatus === 'expire' || transactionStatus === 'deny') {
      nextStatus = 'BATAL';
      dbStatusTransaction = 'failed';
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

    // --- TAMBAHAN: UPDATE TABEL TRANSACTIONS DI PHPMYADMIN OTOMATIS ---
    await query(
      `UPDATE transactions
       SET status = ?, payment_method = ?, provider_transaction_id = ?
       WHERE order_id = ?`,
      [dbStatusTransaction, paymentType || 'QRIS / Transfer', transactionId, orderId]
    ).catch((err) => {
      logger.warn({ err, orderId }, 'Gagal memperbarui tabel transactions di database');
    });
    // -----------------------------------------------------------------

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