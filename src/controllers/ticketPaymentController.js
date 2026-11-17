const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const midtransClient = require('midtrans-client');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { pool, query } = require('../database');
const { logger } = require('../logger');

const ticketDirectory = path.resolve(__dirname, '../../storage/tickets');
const supportedBanks = new Set(['bca', 'bni', 'bri', 'mandiri', 'permata', 'cimb']);

function getMidtransConfig(requireClientKey = false) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim() || '';
  const clientKey = process.env.MIDTRANS_CLIENT_KEY?.trim() || '';
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
  const serverKeyPrefix = isProduction ? 'Mid-server-' : 'SB-Mid-server-';
  const clientKeyPrefix = isProduction ? 'Mid-client-' : 'SB-Mid-client-';
  if (!serverKey.startsWith(serverKeyPrefix)
    || (requireClientKey && !clientKey.startsWith(clientKeyPrefix))) {
    return null;
  }

  return {
    serverKey,
    ...(clientKey ? { clientKey } : {}),
    isProduction,
  };
}

function getPdfUrl(filename) {
  const configuredUrl = process.env.PUBLIC_API_URL?.trim();
  if (process.env.NODE_ENV === 'production' && !configuredUrl) {
    throw new Error('PUBLIC_API_URL wajib diatur di production untuk tautan PDF tiket');
  }
  const baseUrl = (configuredUrl || `http://localhost:${process.env.PORT || 3001}`)
    .replace(/\/+$/, '');
  return `${baseUrl}/api/tickets/files/${filename}`;
}

async function createTicketPdf({ filename, booking, orderId, amount }) {
  await fs.promises.mkdir(ticketDirectory, { recursive: true });
  const filePath = path.join(ticketDirectory, filename);
  const qrCode = await QRCode.toBuffer(orderId, { errorCorrectionLevel: 'M', margin: 1, width: 180 });

  await new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A5', margin: 36 });
    const output = fs.createWriteStream(filePath);
    output.once('finish', resolve);
    output.once('error', reject);
    document.once('error', reject);

    document.fontSize(20).fillColor('#244b35').text('TIKET MUSEUM BRAWIJAYA', { align: 'center' });
    document.moveDown(0.7);
    document.fontSize(11).fillColor('#222');
    document.text(`Nomor booking: ${booking.id}`);
    document.text(`Nomor pesanan: ${orderId}`);
    document.text(`Nama pengunjung: ${booking.nama}`);
    document.text(`Tanggal kunjungan: ${booking.visit_date}`);
    document.text(`Sesi: ${booking.sesi}`);
    document.text(`Jumlah tiket: ${booking.total_tiket}`);
    document.text(`Total pembayaran: Rp ${amount.toLocaleString('id-ID')}`);
    document.moveDown(0.8);
    document.image(qrCode, { fit: [120, 120], align: 'center' });
    document.moveDown(0.5);
    document.fontSize(9).fillColor('#555').text('Tunjukkan QR code ini saat check-in.', { align: 'center' });
    document.end();
  });
}

exports.checkout = async (req, res) => {
  const bookingId = typeof req.body?.bookingId === 'string' ? req.body.bookingId.trim() : '';
  const paymentMethod = typeof req.body?.paymentMethod === 'string'
    ? req.body.paymentMethod.trim().toUpperCase()
    : '';
  const bank = typeof req.body?.bank === 'string' ? req.body.bank.trim().toLowerCase() : 'bca';

  if (!bookingId || !['QRIS', 'VIRTUAL_ACCOUNT'].includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: 'bookingId dan paymentMethod (QRIS atau VIRTUAL_ACCOUNT) wajib diisi',
    });
  }
  if (paymentMethod === 'VIRTUAL_ACCOUNT' && !supportedBanks.has(bank)) {
    return res.status(400).json({
      success: false,
      message: 'Bank tidak didukung. Pilih BCA, BNI, BRI, Mandiri, Permata, atau CIMB.',
    });
  }

  const midtransConfig = getMidtransConfig(true);
  if (!midtransConfig) {
    logger.error('Konfigurasi Midtrans belum lengkap');
    return res.status(503).json({ success: false, message: 'Layanan pembayaran belum tersedia' });
  }

  let connection;
  let ticketId;
  let createdOrderId;
  let snapCreated = false;
  try {
    const [booking] = await query(
      `SELECT id, nama, email, phone, total_tiket, total_biaya, visit_date, sesi, status
       FROM ticket_bookings WHERE id = ?`,
      [bookingId],
    );
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
    }
    if (booking.status !== 'MENUNGGU') {
      return res.status(409).json({ success: false, message: 'Pemesanan ini tidak dapat dibayar' });
    }

    const amount = Number(booking.total_biaya);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Nominal pemesanan tidak valid' });
    }
    const [user] = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [booking.email]);

    const [existingTicket] = await query(
      `SELECT t.id, t.order_id, t.status, t.payment_method, tr.snap_token
       FROM tickets t LEFT JOIN transactions tr ON tr.ticket_id = t.id
       WHERE t.booking_id = ?`,
      [booking.id],
    );
    if (existingTicket) {
      if (existingTicket.status === 'SUCCESS') {
        return res.status(409).json({ success: false, message: 'Pemesanan ini sudah dibayar' });
      }
      if (existingTicket.payment_method !== paymentMethod) {
        return res.status(409).json({
          success: false,
          message: 'Metode pembayaran untuk pemesanan ini sudah dipilih sebelumnya',
        });
      }
      if (existingTicket.snap_token) {
        return res.json({
          success: true,
          orderId: existingTicket.order_id,
          token: existingTicket.snap_token,
          amount,
        });
      }
      return res.status(409).json({
        success: false,
        message: 'Transaksi sedang diproses. Silakan coba kembali beberapa saat lagi.',
      });
    }

    createdOrderId = `MB-${crypto.randomUUID()}`;
    ticketId = crypto.randomUUID();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO tickets (id, booking_id, order_id, user_id, user_name, amount, payment_method, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        ticketId,
        booking.id,
        createdOrderId,
        user?.id ?? null,
        booking.nama,
        amount,
        paymentMethod,
      ],
    );
    await connection.execute(
      `INSERT INTO transactions (id, ticket_id, order_id, amount, payment_method, status)
       VALUES (?, ?, ?, ?, ?, 'PENDING')`,
      [crypto.randomUUID(), ticketId, createdOrderId, amount, paymentMethod],
    );
    await connection.commit();
    connection.release();
    connection = null;

    const snap = new midtransClient.Snap(midtransConfig);
    const transaction = await snap.createTransaction({
      transaction_details: { order_id: createdOrderId, gross_amount: amount },
      customer_details: {
        first_name: booking.nama,
        email: booking.email,
        ...(booking.phone ? { phone: booking.phone } : {}),
      },
      item_details: [{
        id: 'TICKET-MB',
        price: amount,
        quantity: 1,
        name: `Tiket Museum Brawijaya (${booking.total_tiket} tiket)`,
      }],
      enabled_payments: paymentMethod === 'QRIS' ? ['qris'] : ['bank_transfer'],
      ...(paymentMethod === 'VIRTUAL_ACCOUNT' ? { bank_transfer: { bank } } : {}),
    });
    snapCreated = true;

    await query('UPDATE transactions SET snap_token = ? WHERE ticket_id = ?', [
      transaction.token,
      ticketId,
    ]);

    return res.status(201).json({
      success: true,
      message: 'Transaksi pembayaran berhasil dibuat',
      orderId: createdOrderId,
      token: transaction.token,
      redirect_url: transaction.redirect_url,
      amount,
      paymentMethod,
    });
  } catch (error) {
    logger.error({ err: error, bookingId }, 'Gagal membuat checkout tiket');
    if (connection) {
      await connection.rollback().catch((rollbackError) => {
        logger.error({ err: rollbackError, bookingId }, 'Gagal membatalkan checkout');
      });
    }
    if (ticketId && !snapCreated) {
      try {
        await query('DELETE FROM tickets WHERE id = ? AND status = \'PENDING\'', [ticketId]);
      } catch (cleanupError) {
        logger.error({ err: cleanupError, bookingId }, 'Gagal membersihkan checkout yang tidak berhasil');
      }
    }
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Checkout untuk pemesanan ini sedang dibuat. Silakan coba kembali.',
      });
    }
    return res.status(500).json({ success: false, message: 'Gagal membuat transaksi pembayaran' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

exports.handleWebhook = async (req, res) => {
  const midtransConfig = getMidtransConfig();
  if (!midtransConfig) {
    logger.error('Konfigurasi Midtrans belum lengkap');
    return res.status(503).json({ success: false, message: 'Layanan pembayaran belum tersedia' });
  }

  const notification = req.body;
  if (!notification || typeof notification.order_id !== 'string') {
    return res.status(400).json({ success: false, message: 'Notifikasi Midtrans tidak valid' });
  }

  let connection;
  try {
    const coreApi = new midtransClient.CoreApi(midtransConfig);
    const payment = await coreApi.transaction.notification(notification);
    const orderId = payment.order_id;
    const amount = Number(payment.gross_amount);
    const isPaid = payment.transaction_status === 'settlement'
      || (payment.transaction_status === 'capture' && payment.fraud_status === 'accept');
    const isFailed = ['cancel', 'expire', 'deny'].includes(payment.transaction_status);

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT t.id, t.order_id, t.user_name, t.amount, t.status AS ticket_status, t.pdf_url,
              tr.status AS transaction_status, b.id AS booking_id, b.nama, b.total_tiket,
              b.visit_date, b.sesi
       FROM tickets t
       JOIN transactions tr ON tr.ticket_id = t.id
       JOIN ticket_bookings b ON b.id = t.booking_id
       WHERE t.order_id = ? AND tr.order_id = ? FOR UPDATE`,
      [orderId, orderId],
    );
    const ticket = rows[0];
    if (!ticket) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    }
    if (!Number.isSafeInteger(amount) || amount !== Number(ticket.amount)) {
      await connection.rollback();
      logger.error({ orderId }, 'Nominal notifikasi Midtrans tidak sesuai transaksi');
      return res.status(400).json({ success: false, message: 'Nominal transaksi tidak sesuai' });
    }

    let pdfUrl = ticket.pdf_url;
    if (isPaid) {
      if (!pdfUrl) {
        const filename = `${crypto.createHash('sha256').update(orderId).digest('hex')}.pdf`;
        pdfUrl = getPdfUrl(filename);
        await createTicketPdf({
          filename,
          booking: {
            id: ticket.booking_id,
            nama: ticket.nama,
            total_tiket: ticket.total_tiket,
            visit_date: ticket.visit_date,
            sesi: ticket.sesi,
          },
          orderId,
          amount,
        });
      }
      await connection.execute(
        `UPDATE tickets SET status = 'SUCCESS', pdf_url = ? WHERE id = ?`,
        [pdfUrl, ticket.id],
      );
      await connection.execute(
        `UPDATE transactions SET status = 'SUCCESS', provider_transaction_id = ? WHERE ticket_id = ?`,
        [payment.transaction_id || null, ticket.id],
      );
      await connection.execute(
        `UPDATE ticket_bookings SET status = 'LUNAS', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'MENUNGGU'`,
        [ticket.booking_id],
      );
    } else if (isFailed && ticket.ticket_status === 'PENDING') {
      await connection.execute(
        `UPDATE tickets SET status = 'FAILED' WHERE id = ? AND status = 'PENDING'`,
        [ticket.id],
      );
      await connection.execute(
        `UPDATE transactions SET status = 'FAILED', provider_transaction_id = ? WHERE ticket_id = ? AND status = 'PENDING'`,
        [payment.transaction_id || null, ticket.id],
      );
      await connection.execute(
        `UPDATE ticket_bookings SET status = 'BATAL', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'MENUNGGU'`,
        [ticket.booking_id],
      );
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: 'Notifikasi pembayaran berhasil diverifikasi',
      orderId,
      status: isPaid ? 'SUCCESS' : isFailed ? 'FAILED' : ticket.ticket_status,
      pdfUrl: isPaid ? pdfUrl : undefined,
    });
  } catch (error) {
    if (connection) {
      await connection.rollback().catch((rollbackError) => {
        logger.error({ err: rollbackError }, 'Gagal membatalkan transaksi webhook');
      });
    }
    logger.error({ err: error }, 'Gagal memverifikasi notifikasi Midtrans');
    return res.status(500).json({ success: false, message: 'Gagal memverifikasi notifikasi pembayaran' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

exports.getTicketPdf = async (req, res) => {
  const filename = req.params.filename;
  if (!/^[a-f0-9]{64}\.pdf$/.test(filename)) {
    return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });
  }
  try {
    const pdfUrl = getPdfUrl(filename);
    const [ticket] = await query(
      'SELECT id FROM tickets WHERE pdf_url = ? AND status = \'SUCCESS\'',
      [pdfUrl],
    );
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });
    }
    return res.sendFile(path.join(ticketDirectory, filename), (error) => {
      if (error && !res.headersSent) {
        logger.error({ err: error, ticketId: ticket.id }, 'Gagal mengirim PDF tiket');
        res.status(error.statusCode || 500).json({
          success: false,
          message: 'File tiket tidak tersedia',
        });
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Gagal mengambil PDF tiket');
    return res.status(500).json({ success: false, message: 'Gagal mengambil PDF tiket' });
  }
};
