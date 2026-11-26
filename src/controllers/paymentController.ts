import crypto from 'node:crypto';
import midtransClient from 'midtrans-client';
import type { Request, Response } from 'express';
import { query } from '../database';
import { paymentModel } from '../models/paymentModel';
import { logger } from '../logger';
import { sendTicketNotification } from '../emailService';
import {
  buildQrisCheckoutUrl,
  buildQrisImageUrl,
  buildSandboxQrisPayload,
  buildTicketPdfDownloadUrl,
  buildTicketQrImageUrl,
  ensureTicketPdf,
  generateQrisPngBuffer,
  generateTicketQrPngBuffer,
  sanitizeArtifactKey,
} from '../lib/ticketArtifact';

// Menyimpan booking yang halaman QRIS Sandbox-nya sudah dibuka pada proses server saat ini
const sandboxOpenedBookings = new Map<string, number>();

function getOrderId(bookingId: string): string {
  const clean = bookingId.replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '-');
  return clean.toUpperCase().startsWith('MB-') ? clean : `MB-${clean}`;
}

function getLegacyOrderId(bookingId: string): string {
  return `MB-${bookingId.replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function getVeryLegacyOrderId(bookingId: string): string {
  return `MB-${bookingId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function getCandidateOrderIds(bookingId: string, storedOrderId?: string | null): string[] {
  const candidates = [
    storedOrderId?.trim() || '',
    getOrderId(bookingId),
    getLegacyOrderId(bookingId),
    getVeryLegacyOrderId(bookingId),
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function isOrderIdForBooking(bookingId: string, orderId: string): boolean {
  return getCandidateOrderIds(bookingId).includes(orderId);
}

function buildSnapRedirectUrl(token: string, isProduction: boolean): string {
  const host = isProduction ? 'app.midtrans.com' : 'app.sandbox.midtrans.com';
  return `https://${host}/snap/v4/redirection/${encodeURIComponent(token)}`;
}

/** Memetakan metode pembayaran dari aplikasi ke channel Midtrans Snap (`enabled_payments`). */
function getEnabledPayments(paymentMethod?: string | null): string[] | undefined {
  const method = (paymentMethod || '').trim().toUpperCase();
  if (method === 'CREDIT_CARD') {
    return ['credit_card'];
  }
  if (method === 'BANK' || method === 'BANK_TRANSFER') {
    return ['bca_va', 'bni_va', 'bri_va', 'permata_va', 'echannel', 'other_va'];
  }
  if (method === 'QRIS') {
    return ['other_qris', 'gopay', 'shopeepay'];
  }
  return undefined;
}

function isProductionMode(): boolean {
  return process.env.MIDTRANS_IS_PRODUCTION === 'true';
}

function getMidtransKeys(requireClientKey = false) {
  const isProduction = isProductionMode();
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim() || '';
  const clientKey = process.env.MIDTRANS_CLIENT_KEY?.trim() || '';
  const serverKeyPrefix = isProduction ? 'Mid-server-' : 'SB-Mid-server-';
  const clientKeyPrefix = isProduction ? 'Mid-client-' : 'SB-Mid-client-';
  if (
    !serverKey.startsWith(serverKeyPrefix)
    || (requireClientKey && !clientKey.startsWith(clientKeyPrefix))
  ) {
    return null;
  }
  return { isProduction, serverKey, clientKey };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRupiah(amount: number): string {
  return `Rp ${Math.round(Number(amount) || 0).toLocaleString('id-ID')}`;
}

async function findStoredTransactionForBooking(bookingId: string): Promise<{
  orderId: string | null;
  snapToken: string | null;
  status: string | null;
  pdfUrl: string | null;
} | null> {
  const [ticketRow] = await query<Array<{
    order_id?: string | null;
    status?: string | null;
    pdf_url?: string | null;
    snap_token?: string | null;
  }>>(
    `SELECT t.order_id, t.status, t.pdf_url, tr.snap_token
     FROM tickets t
     LEFT JOIN transactions tr ON tr.ticket_id = t.id
     WHERE t.booking_id = ?
     LIMIT 1`,
    [bookingId],
  );
  if (ticketRow) {
    return {
      orderId: ticketRow.order_id?.trim() || null,
      snapToken: ticketRow.snap_token?.trim() || null,
      status: ticketRow.status?.trim() || null,
      pdfUrl: ticketRow.pdf_url?.trim() || null,
    };
  }

  const candidates = getCandidateOrderIds(bookingId);
  for (const candidate of candidates) {
    const [txRow] = await query<Array<{
      order_id?: string | null;
      snap_token?: string | null;
      status?: string | null;
    }>>(
      'SELECT order_id, snap_token, status FROM transactions WHERE order_id = ? LIMIT 1',
      [candidate],
    );
    if (txRow) {
      return {
        orderId: txRow.order_id?.trim() || candidate,
        snapToken: txRow.snap_token?.trim() || null,
        status: txRow.status?.trim() || null,
        pdfUrl: null,
      };
    }
  }

  return null;
}

async function upsertTransactionRecord(params: {
  booking: NonNullable<Awaited<ReturnType<typeof paymentModel.findBookingByIdOrHash>>>;
  orderId: string;
  amount: number;
  paymentMethod: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  snapToken?: string | null;
  providerTransactionId?: string | null;
  pdfUrl?: string | null;
}) {
  const { booking, orderId, amount, paymentMethod, status } = params;

  // Pastikan parent row di tabel `tickets` tersedia agar FK `transactions.ticket_id -> tickets.id` terpenuhi
  const [existingTicket] = await query<Array<{ id: string }>>(
    'SELECT id FROM tickets WHERE booking_id = ? OR order_id = ? LIMIT 1',
    [booking.id, orderId],
  );

  let ticketRowId = existingTicket?.id;
  if (!ticketRowId) {
    const user = await paymentModel.findUserByEmail(booking.email).catch(() => null);
    ticketRowId = crypto.randomUUID();
    await query(
      `INSERT INTO tickets
        (id, booking_id, order_id, user_id, user_name, amount, payment_method, status, pdf_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        ticketRowId,
        booking.id,
        orderId,
        user?.id ?? null,
        booking.nama,
        amount,
        paymentMethod,
        status,
        params.pdfUrl ?? null,
      ],
    );
  } else {
    await query(
      `UPDATE tickets
       SET amount = ?, payment_method = ?, status = ?, pdf_url = COALESCE(?, pdf_url)
       WHERE id = ?`,
      [amount, paymentMethod, status, params.pdfUrl ?? null, ticketRowId],
    );
  }

  const [existingTx] = await query<Array<{ id: string }>>(
    'SELECT id FROM transactions WHERE order_id = ? OR ticket_id = ? LIMIT 1',
    [orderId, ticketRowId],
  );

  if (existingTx) {
    await query(
      `UPDATE transactions
       SET amount = ?,
           payment_method = ?,
           status = ?,
           snap_token = COALESCE(?, snap_token),
           provider_transaction_id = COALESCE(?, provider_transaction_id)
       WHERE id = ?`,
      [
        amount,
        paymentMethod,
        status,
        params.snapToken ?? null,
        params.providerTransactionId ?? null,
        existingTx.id,
      ],
    );
    return;
  }

  await query(
    `INSERT INTO transactions
      (id, ticket_id, order_id, amount, payment_method, status, provider_transaction_id, snap_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      crypto.randomUUID(),
      ticketRowId,
      orderId,
      amount,
      paymentMethod,
      status,
      params.providerTransactionId ?? null,
      params.snapToken ?? null,
    ],
  );
}

async function syncBookingWithMidtransStatus({
  booking,
  orderId,
  transactionStatus,
  fraudStatus,
  paymentType,
  transactionId,
  grossAmountRaw,
  req,
}: {
  booking: NonNullable<Awaited<ReturnType<typeof paymentModel.findBookingByIdOrHash>>>;
  orderId: string;
  transactionStatus: string;
  fraudStatus?: string;
  paymentType?: string;
  transactionId?: string;
  grossAmountRaw?: string | number;
  req?: Request;
}) {
  if (grossAmountRaw !== undefined && grossAmountRaw !== null && String(grossAmountRaw).trim() !== '') {
    const grossAmount = Math.round(Number(grossAmountRaw));
    if (!Number.isSafeInteger(grossAmount) || grossAmount !== Number(booking.total_biaya)) {
      return {
        amountMismatch: true,
        nextBookingStatus: booking.status,
        statusChanged: false,
        pdfUrl: null as string | null,
      };
    }
  }

  let nextStatus: 'LUNAS' | 'BATAL' | null = null;
  let dbStatusTransaction: 'PENDING' | 'SUCCESS' | 'FAILED' = 'PENDING';
  if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus !== 'challenge')) {
    nextStatus = 'LUNAS';
    dbStatusTransaction = 'SUCCESS';
  } else if (transactionStatus === 'cancel' || transactionStatus === 'expire' || transactionStatus === 'deny') {
    nextStatus = 'BATAL';
    dbStatusTransaction = 'FAILED';
  }

  let statusChanged = false;
  if (nextStatus === 'LUNAS' && booking.status !== 'LUNAS') {
    const result = await query<any>(
      "UPDATE ticket_bookings SET status = 'LUNAS', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'LUNAS'",
      [booking.id],
    );
    statusChanged = (result?.affectedRows ?? 0) > 0;
  } else if (nextStatus === 'BATAL' && booking.status === 'MENUNGGU') {
    const result = await query<any>(
      "UPDATE ticket_bookings SET status = 'BATAL', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'MENUNGGU'",
      [booking.id],
    );
    statusChanged = (result?.affectedRows ?? 0) > 0;
  }

  let pdfUrl: string | null = null;
  if (nextStatus === 'LUNAS' || booking.status === 'LUNAS') {
    try {
      const artifact = await ensureTicketPdf({
        booking,
        orderId,
        amount: Number(booking.total_biaya),
        req,
      });
      pdfUrl = artifact.pdfUrl;
    } catch (err) {
      logger.warn({ err, bookingId: booking.id }, 'Gagal membuat berkas E-Tiket PDF');
      pdfUrl = buildTicketPdfDownloadUrl(booking.id, req);
    }
  }

  await upsertTransactionRecord({
    booking,
    orderId,
    amount: Number(booking.total_biaya),
    paymentMethod: paymentType || booking.payment_method || 'QRIS / Transfer',
    status: dbStatusTransaction,
    providerTransactionId: transactionId || null,
    pdfUrl,
  }).catch((err) => {
    logger.warn({ err, orderId }, 'Gagal memperbarui tabel transactions di database');
  });

  if (statusChanged && nextStatus === 'LUNAS') {
    sendTicketNotification({
      to: booking.email,
      nama: booking.nama,
      bookingId: booking.id,
      totalTiket: booking.total_tiket,
      totalBiaya: booking.total_biaya,
      visitDate: booking.visit_date || '',
      sesi: booking.sesi || '',
      isMancanegara: Boolean(booking.is_mancanegara),
    }).then((result) => {
      if (!result.success) {
        logger.warn({ bookingId: booking.id }, 'Gagal mengirim email e-tiket setelah pembayaran');
      }
    }).catch((error) => {
      logger.error({ err: error, bookingId: booking.id }, 'Gagal mengirim email e-tiket setelah pembayaran');
    });
  }

  return {
    amountMismatch: false,
    nextBookingStatus: statusChanged && nextStatus ? nextStatus : (nextStatus === 'LUNAS' ? 'LUNAS' : booking.status),
    statusChanged,
    pdfUrl,
  };
}

export const createTransaction = async (req: Request, res: Response) => {
  const { bookingId } = req.body;
  if (typeof bookingId !== 'string' || !bookingId.trim()) {
    return res.status(400).json({
      success: false,
      message: 'bookingId wajib diisi',
    });
  }

  const keys = getMidtransKeys(true);
  if (!keys) {
    logger.error('Key Midtrans tidak lengkap atau tidak sesuai dengan mode yang dipilih');
    return res.status(503).json({
      success: false,
      message: 'Layanan pembayaran belum tersedia',
    });
  }

  try {
    const booking = await paymentModel.findBookingByIdOrHash(bookingId.trim());
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Pemesanan tidak ditemukan',
      });
    }
    if (booking.status !== 'MENUNGGU') {
      return res.status(409).json({
        success: false,
        message: booking.status === 'LUNAS'
          ? 'Pemesanan ini sudah lunas dibayar'
          : 'Pembayaran hanya tersedia untuk pemesanan yang menunggu pembayaran',
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

    const stored = await findStoredTransactionForBooking(booking.id).catch(() => null);
    const orderId = stored?.orderId || getOrderId(booking.id);
    const checkoutUrl = buildQrisCheckoutUrl(booking.id, req);

    if (stored?.snapToken) {
      const snapRedirectUrl = buildSnapRedirectUrl(stored.snapToken, keys.isProduction);
      return res.status(200).json({
        success: true,
        message: 'Halaman pembayaran Midtrans Snap siap digunakan',
        token: stored.snapToken,
        order_id: orderId,
        redirect_url: snapRedirectUrl,
        snap_redirect_url: snapRedirectUrl,
        qris_image_url: buildQrisImageUrl(booking.id, req),
        ticket_pdf_url: buildTicketPdfDownloadUrl(booking.id, req),
        sandbox: !keys.isProduction,
      });
    }

    const snap = new (midtransClient as any).Snap({
      isProduction: keys.isProduction,
      serverKey: keys.serverKey,
      clientKey: keys.clientKey,
    });

    let snapToken: string | null = null;
    let snapRedirectUrl = '';
    const enabledPayments = getEnabledPayments(booking.payment_method);

    try {
      const transaction = await snap.createTransaction({
        transaction_details: {
          order_id: orderId,
          gross_amount: grossAmount,
        },
        ...(enabledPayments ? { enabled_payments: enabledPayments } : {}),
        credit_card: {
          secure: true,
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
      snapToken = transaction.token;
      snapRedirectUrl = transaction.redirect_url;
    } catch (snapError: any) {
      const apiResponse = snapError && typeof snapError === 'object' ? snapError.ApiResponse : undefined;
      const errorMessages = Array.isArray(apiResponse?.error_messages)
        ? apiResponse.error_messages.join(' ')
        : '';

      if (keys.isProduction) {
        throw snapError;
      }

      // Di Sandbox, jika Midtrans sementara gagal / order_id sudah pernah dibuat, tetap lanjutkan ke halaman QRIS Sandbox
      logger.warn(
        { err: snapError, orderId, errorMessages },
        'Pembuatan Snap Sandbox mengalami kendala; beralih ke halaman QRIS Sandbox lokal',
      );
    }

    await upsertTransactionRecord({
      booking,
      orderId,
      amount: grossAmount,
      paymentMethod: booking.payment_method || 'QRIS',
      status: 'PENDING',
      snapToken,
    }).catch((err) => {
      logger.warn({ err, orderId }, 'Gagal mencatat transaksi awal ke database');
    });

    return res.status(200).json({
      success: true,
      message: snapRedirectUrl
        ? 'Halaman pembayaran Midtrans Snap siap digunakan'
        : 'Halaman pembayaran Sandbox lokal siap digunakan (isi MIDTRANS_SERVER_KEY/CLIENT_KEY asli untuk Midtrans Snap)',
      token: snapToken,
      order_id: orderId,
      redirect_url: snapRedirectUrl || checkoutUrl,
      snap_redirect_url: snapRedirectUrl || null,
      qris_image_url: buildQrisImageUrl(booking.id, req),
      ticket_pdf_url: buildTicketPdfDownloadUrl(booking.id, req),
      sandbox: !keys.isProduction,
    });
  } catch (error: any) {
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

export const checkTransactionStatus = async (req: Request, res: Response) => {
  const rawBookingId =
    (typeof req.body?.bookingId === 'string' && req.body.bookingId.trim())
    || (typeof req.params?.bookingId === 'string' && decodeURIComponent(req.params.bookingId).trim())
    || (typeof req.query?.bookingId === 'string' && req.query.bookingId.trim())
    || '';

  if (!rawBookingId) {
    return res.status(400).json({
      success: false,
      message: 'bookingId wajib diisi',
    });
  }

  const booking = await paymentModel.findBookingByIdOrHash(rawBookingId);
  if (!booking) {
    return res.status(404).json({
      success: false,
      message: 'Pemesanan tidak ditemukan',
    });
  }

  const stored = await findStoredTransactionForBooking(booking.id).catch(() => null);
  const primaryOrderId = stored?.orderId || getOrderId(booking.id);

  if (booking.status === 'LUNAS') {
    const artifact = await ensureTicketPdf({
      booking,
      orderId: primaryOrderId,
      amount: Number(booking.total_biaya),
      req,
    }).catch(() => null);

    return res.status(200).json({
      success: true,
      bookingStatus: 'LUNAS',
      transactionStatus: 'settlement',
      message: 'Pembayaran sudah lunas. E-tiket Anda siap digunakan.',
      pdfUrl: artifact?.pdfUrl || buildTicketPdfDownloadUrl(booking.id, req),
      qrImageUrl: buildTicketQrImageUrl(booking.id, req),
      data: booking,
    });
  }

  if (booking.status === 'BATAL') {
    return res.status(200).json({
      success: true,
      bookingStatus: 'BATAL',
      transactionStatus: 'cancel',
      message: 'Pemesanan telah dibatalkan atau kedaluwarsa.',
      data: booking,
    });
  }

  const keys = getMidtransKeys(false);
  const qrisShownRequested =
    req.body?.qrisShown === true
    || req.body?.qrisShown === 'true'
    || req.query?.qrisShown === 'true';

  let midtransTx: any = null;
  let matchedOrderId = primaryOrderId;
  let sawMidtrans404 = false;

  if (keys) {
    const coreApi = new (midtransClient as any).CoreApi({
      isProduction: keys.isProduction,
      serverKey: keys.serverKey,
      clientKey: keys.clientKey,
    });

    const candidateOrderIds = getCandidateOrderIds(booking.id, stored?.orderId);
    for (const candidate of candidateOrderIds) {
      try {
        midtransTx = await coreApi.transaction.status(candidate);
        matchedOrderId = candidate;
        break;
      } catch (error: any) {
        const statusCode = Number(
          error?.httpStatusCode || error?.statusCode || error?.ApiResponse?.status_code || 0,
        );
        if (statusCode === 404) {
          sawMidtrans404 = true;
          continue;
        }
        logger.warn({ err: error, bookingId: booking.id, orderId: candidate }, 'Gagal mengecek status transaksi ke Midtrans');
      }
    }
  }

  const rawMidtransStatus = String(midtransTx?.transaction_status || '').toLowerCase();
  const isSandbox = !isProductionMode();
  const hasOpenedQrisInSandbox =
    isSandbox && (
      qrisShownRequested
      || sandboxOpenedBookings.has(booking.id)
      || rawMidtransStatus === 'pending'
      || Boolean(stored)
    );

  // Di mode Sandbox, begitu QRIS/halaman pembayaran sudah muncul lalu pengguna menekan Cek Status / Download QRIS,
  // langsung konfirmasi transaksi menjadi LUNAS dan siapkan E-Tiket PDF.
  if (
    rawMidtransStatus === 'settlement'
    || (rawMidtransStatus === 'capture' && String(midtransTx?.fraud_status || '') !== 'challenge')
    || hasOpenedQrisInSandbox
  ) {
    const synced = await syncBookingWithMidtransStatus({
      booking,
      orderId: matchedOrderId,
      transactionStatus: 'settlement',
      fraudStatus: midtransTx?.fraud_status ? String(midtransTx.fraud_status) : 'accept',
      paymentType: midtransTx?.payment_type
        ? String(midtransTx.payment_type)
        : (booking.payment_method || 'qris'),
      transactionId: midtransTx?.transaction_id
        ? String(midtransTx.transaction_id)
        : `SANDBOX-QRIS-${Date.now()}`,
      grossAmountRaw: midtransTx?.gross_amount,
      req,
    });

    if (synced.amountMismatch) {
      return res.status(400).json({
        success: false,
        message: 'Nominal transaksi tidak sesuai dengan tagihan pemesanan',
      });
    }

    const latestBooking = await paymentModel.findBookingById(booking.id) || booking;
    return res.status(200).json({
      success: true,
      bookingStatus: 'LUNAS',
      transactionStatus: 'settlement',
      message: 'Pembayaran QRIS berhasil diverifikasi! Status pesanan sekarang LUNAS dan E-Tiket Anda sudah aktif.',
      pdfUrl: synced.pdfUrl || buildTicketPdfDownloadUrl(booking.id, req),
      qrImageUrl: buildTicketQrImageUrl(booking.id, req),
      data: latestBooking,
    });
  }

  if (['cancel', 'expire', 'deny'].includes(rawMidtransStatus)) {
    const synced = await syncBookingWithMidtransStatus({
      booking,
      orderId: matchedOrderId,
      transactionStatus: rawMidtransStatus,
      paymentType: midtransTx?.payment_type ? String(midtransTx.payment_type) : undefined,
      transactionId: midtransTx?.transaction_id ? String(midtransTx.transaction_id) : undefined,
      grossAmountRaw: midtransTx?.gross_amount,
      req,
    });
    const latestBooking = await paymentModel.findBookingById(booking.id) || booking;
    return res.status(200).json({
      success: true,
      bookingStatus: synced.nextBookingStatus,
      transactionStatus: rawMidtransStatus,
      message: 'Pembayaran dibatalkan atau kedaluwarsa.',
      data: latestBooking,
    });
  }

  if (sawMidtrans404 && !stored) {
    return res.status(200).json({
      success: true,
      bookingStatus: booking.status,
      transactionStatus: 'pending',
      message: 'Belum ada pembayaran masuk. Silakan klik "Lanjutkan Pembayaran (Midtrans)" agar QRIS muncul terlebih dahulu.',
      data: booking,
    });
  }

  return res.status(200).json({
    success: true,
    bookingStatus: booking.status,
    transactionStatus: rawMidtransStatus || 'pending',
    message: 'Pembayaran masih menunggu penyelesaian di halaman Midtrans.',
    data: booking,
  });
};

export const getQrisImage = async (req: Request, res: Response) => {
  const rawBookingId = decodeURIComponent(String(req.params?.bookingId || '')).trim();
  if (!rawBookingId) {
    return res.status(400).json({ success: false, message: 'bookingId wajib diisi' });
  }

  const booking = await paymentModel.findBookingByIdOrHash(rawBookingId);
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
  }

  const stored = await findStoredTransactionForBooking(booking.id).catch(() => null);
  const orderId = stored?.orderId || getOrderId(booking.id);

  if (!isProductionMode()) {
    sandboxOpenedBookings.set(booking.id, Date.now());
  }

  const payload = buildSandboxQrisPayload({
    bookingId: booking.id,
    orderId,
    amount: Number(booking.total_biaya),
    nama: booking.nama,
  });
  const pngBuffer = await generateQrisPngBuffer(payload);
  const safeKey = sanitizeArtifactKey(orderId);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.query?.download === '1' || req.query?.download === 'true') {
    res.setHeader('Content-Disposition', `attachment; filename="QRIS-${safeKey}.png"`);
  }
  return res.status(200).send(pngBuffer);
};

export const getTicketQrImage = async (req: Request, res: Response) => {
  const rawBookingId = decodeURIComponent(String(req.params?.bookingId || '')).trim();
  if (!rawBookingId) {
    return res.status(400).json({ success: false, message: 'bookingId wajib diisi' });
  }

  const booking = await paymentModel.findBookingByIdOrHash(rawBookingId);
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
  }

  const pngBuffer = await generateTicketQrPngBuffer(booking.id);
  const safeKey = sanitizeArtifactKey(booking.id);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.query?.download === '1' || req.query?.download === 'true') {
    res.setHeader('Content-Disposition', `attachment; filename="QR-ETiket-${safeKey}.png"`);
  }
  return res.status(200).send(pngBuffer);
};

export const downloadTicketPdf = async (req: Request, res: Response) => {
  const rawBookingId = decodeURIComponent(String(req.params?.bookingId || '')).trim();
  if (!rawBookingId) {
    return res.status(400).json({ success: false, message: 'bookingId wajib diisi' });
  }

  const booking = await paymentModel.findBookingByIdOrHash(rawBookingId);
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
  }

  if (booking.status !== 'LUNAS') {
    return res.status(409).json({
      success: false,
      message: 'E-Tiket PDF hanya tersedia setelah pembayaran berstatus LUNAS',
    });
  }

  const stored = await findStoredTransactionForBooking(booking.id).catch(() => null);
  const orderId = stored?.orderId || getOrderId(booking.id);
  const artifact = await ensureTicketPdf({
    booking,
    orderId,
    amount: Number(booking.total_biaya),
    req,
  });

  const safeKey = sanitizeArtifactKey(booking.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ETiket-${safeKey}.pdf"`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.sendFile(artifact.filePath);
};

export const serveCheckoutScript = (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(`
(function () {
  var root = document.getElementById('qris-checkout-app');
  if (!root) return;

  var bookingId = root.dataset.bookingId || '';
  var statusUrl = root.dataset.statusUrl || '/api/payment/status';
  var qrisDownloadUrl = root.dataset.qrisDownloadUrl || '';
  var pdfUrl = root.dataset.pdfUrl || '';
  var initialPaid = root.dataset.isPaid === 'true';

  var countdownEl = document.getElementById('countdown-timer');
  var statusBanner = document.getElementById('status-banner');
  var paymentSection = document.getElementById('payment-section');
  var paidSection = document.getElementById('paid-section');
  var downloadQrisBtn = document.getElementById('btn-download-qris');
  var checkStatusBtn = document.getElementById('btn-check-status');
  var downloadPdfBtn = document.getElementById('btn-download-pdf');
  var closeBtn = document.getElementById('btn-close-window');
  var statusBadge = document.getElementById('header-status-badge');

  var remainingSeconds = 15 * 60;
  function updateCountdown() {
    if (!countdownEl) return;
    var mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    var secs = String(remainingSeconds % 60).padStart(2, '0');
    countdownEl.textContent = '00:' + mins + ':' + secs;
    if (remainingSeconds > 0) remainingSeconds -= 1;
  }
  if (!initialPaid) {
    updateCountdown();
    setInterval(updateCountdown, 1000);
  }

  function showBanner(text, isError) {
    if (!statusBanner) return;
    statusBanner.textContent = text;
    statusBanner.className = 'banner ' + (isError ? 'banner-error' : 'banner-success');
    statusBanner.style.display = 'block';
  }

  function switchToPaid(message, nextPdfUrl) {
    if (paymentSection) paymentSection.style.display = 'none';
    if (paidSection) paidSection.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = 'LUNAS';
      statusBadge.className = 'badge badge-paid';
    }
    if (nextPdfUrl && downloadPdfBtn) {
      downloadPdfBtn.setAttribute('href', nextPdfUrl);
    }
    showBanner(message || 'Pembayaran berhasil! Status pesanan sekarang LUNAS.', false);
  }

  async function verifyAndSettle(triggerLabel) {
    if (checkStatusBtn) {
      checkStatusBtn.disabled = true;
      checkStatusBtn.textContent = 'Memverifikasi pembayaran...';
    }
    try {
      var response = await fetch(statusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ bookingId: bookingId, qrisShown: true }),
      });
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Gagal memverifikasi status pembayaran.');
      }
      if (String(data.bookingStatus || '').toUpperCase() === 'LUNAS') {
        switchToPaid(data.message, data.pdfUrl || pdfUrl);
      } else {
        showBanner(data.message || 'Pembayaran masih menunggu konfirmasi.', false);
      }
    } catch (err) {
      showBanner((err && err.message) || ('Gagal saat ' + triggerLabel), true);
    } finally {
      if (checkStatusBtn) {
        checkStatusBtn.disabled = false;
        checkStatusBtn.textContent = 'Check status';
      }
    }
  }

  if (downloadQrisBtn) {
    downloadQrisBtn.addEventListener('click', function () {
      if (qrisDownloadUrl) {
        var link = document.createElement('a');
        link.href = qrisDownloadUrl;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      verifyAndSettle('Download QRIS');
    });
  }

  if (checkStatusBtn) {
    checkStatusBtn.addEventListener('click', function () {
      verifyAndSettle('Check status');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      window.close();
      showBanner('Pembayaran sudah LUNAS. Silakan kembali ke tab aplikasi Museum Brawijaya.', false);
    });
  }
})();
`);
};

export const renderQrisCheckoutPage = async (req: Request, res: Response) => {
  const rawBookingId = decodeURIComponent(String(req.params?.bookingId || '')).trim();
  if (!rawBookingId) {
    return res.status(400).send('bookingId wajib diisi');
  }

  const booking = await paymentModel.findBookingByIdOrHash(rawBookingId);
  if (!booking) {
    return res.status(404).send('Pemesanan tiket tidak ditemukan');
  }

  const stored = await findStoredTransactionForBooking(booking.id).catch(() => null);
  const orderId = stored?.orderId || getOrderId(booking.id);

  // Di Production, arahkan langsung ke halaman Midtrans Snap resmi
  if (isProductionMode()) {
    if (stored?.snapToken) {
      return res.redirect(buildSnapRedirectUrl(stored.snapToken, true));
    }
    return res.status(404).send('Halaman pembayaran tidak tersedia');
  }

  sandboxOpenedBookings.set(booking.id, Date.now());
  if (!stored) {
    await upsertTransactionRecord({
      booking,
      orderId,
      amount: Number(booking.total_biaya),
      paymentMethod: booking.payment_method || 'QRIS',
      status: booking.status === 'LUNAS' ? 'SUCCESS' : 'PENDING',
    }).catch(() => {});
  }

  const isPaid = booking.status === 'LUNAS';
  const method = (booking.payment_method || 'QRIS').trim().toUpperCase();
  const isBank = method === 'BANK' || method === 'BANK_TRANSFER';
  const isCard = method === 'CREDIT_CARD';
  const pageTitle = isBank
    ? 'Pembayaran Transfer Bank — Museum Brawijaya'
    : isCard
      ? 'Pembayaran Kartu Kredit — Museum Brawijaya'
      : 'Pembayaran QRIS — Museum Brawijaya';
  const vaDigits = booking.id.replace(/\D/g, '').padStart(10, '0').slice(-10);
  const vaNumber = `880108${vaDigits}`;

  const qrisImgSrc = buildQrisImageUrl(booking.id, req);
  const qrisDownloadUrl = `${qrisImgSrc}?download=1`;
  const ticketQrUrl = buildTicketQrImageUrl(booking.id, req);
  const ticketPdfUrl = buildTicketPdfDownloadUrl(booking.id, req);
  const snapUrl = stored?.snapToken ? buildSnapRedirectUrl(stored.snapToken, false) : '';

  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'",
  );
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  return res.status(200).send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f3f4f6;
      color: #1f2937;
      display: flex;
      justify-content: center;
      padding: 20px 14px 40px;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
      overflow: hidden;
    }
    .topbar {
      padding: 18px 20px 14px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .brand { font-size: 18px; font-weight: 700; color: #111827; }
    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
    }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-paid { background: #d1fae5; color: #065f46; }
    .amount-box {
      background: #f9fafb;
      padding: 16px 20px;
      border-bottom: 1px solid #e5e7eb;
    }
    .amount { font-size: 26px; font-weight: 800; color: #111827; margin: 0 0 4px; }
    .order-id { font-size: 13px; color: #6b7280; margin: 0; }
    .timer-bar {
      background: #eef2ff;
      color: #1e3a8a;
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      padding: 9px 16px;
    }
    .content { padding: 20px; }
    .banner {
      display: none;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
      line-height: 1.45;
    }
    .banner-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .banner-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .qris-frame {
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 16px;
      text-align: center;
      background: #ffffff;
      margin-bottom: 16px;
    }
    .qris-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      font-size: 12px;
      font-weight: 700;
      color: #374151;
    }
    .qris-logo {
      background: #111827;
      color: #ffffff;
      padding: 2px 8px;
      border-radius: 4px;
      letter-spacing: 1px;
      font-size: 11px;
    }
    .qris-frame img {
      width: 220px;
      height: 220px;
      max-width: 100%;
      display: block;
      margin: 6px auto 10px;
    }
    .qris-caption { font-size: 11.5px; color: #6b7280; margin: 0; }
    .guide {
      background: #f3f4f6;
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 13px;
      color: #374151;
      margin-bottom: 18px;
    }
    .guide-title { font-weight: 700; color: #1d4ed8; margin: 0 0 8px; }
    .guide ol { margin: 0; padding-left: 18px; line-height: 1.55; }
    .btn {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 13px 16px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      border: 1.5px solid #1f2937;
      transition: opacity 0.15s ease;
    }
    .btn:disabled { opacity: 0.6; cursor: wait; }
    .btn-outline { background: #ffffff; color: #111827; margin-bottom: 10px; }
    .btn-dark { background: #2d3748; color: #ffffff; border-color: #2d3748; }
    .btn-green { background: #3f5243; color: #ffffff; border-color: #3f5243; margin-bottom: 10px; }
    .snap-link {
      display: block;
      text-align: center;
      margin-top: 14px;
      font-size: 12px;
      color: #4b5563;
      text-decoration: underline;
    }
    .paid-card {
      text-align: center;
      padding: 8px 4px;
    }
    .paid-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #d1fae5;
      color: #059669;
      font-size: 30px;
      line-height: 56px;
      margin: 0 auto 12px;
      font-weight: 800;
    }
    .paid-title { font-size: 19px; font-weight: 800; color: #065f46; margin: 0 0 6px; }
    .paid-sub { font-size: 13px; color: #4b5563; margin: 0 0 16px; }
    .detail-box {
      text-align: left;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 16px;
      font-size: 13px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 4px 0;
    }
    .detail-label { color: #6b7280; }
    .detail-val { font-weight: 700; color: #111827; text-align: right; }
  </style>
</head>
<body>
  <div
    id="qris-checkout-app"
    class="card"
    data-booking-id="${escapeHtml(booking.id)}"
    data-status-url="/api/payment/status"
    data-qris-download-url="${escapeHtml(qrisDownloadUrl)}"
    data-pdf-url="${escapeHtml(ticketPdfUrl)}"
    data-is-paid="${isPaid ? 'true' : 'false'}"
  >
    <div class="topbar">
      <div class="brand">Museum Brawijaya</div>
      <span id="header-status-badge" class="badge ${isPaid ? 'badge-paid' : 'badge-pending'}">${isPaid ? 'LUNAS' : 'MENUNGGU'}</span>
    </div>

    <div class="amount-box">
      <p class="amount">${escapeHtml(formatRupiah(Number(booking.total_biaya)))}</p>
      <p class="order-id">Order ID ${escapeHtml(booking.id)} • ${escapeHtml(booking.nama)}</p>
    </div>

    <div style="padding: 14px 20px 0;">
      <div id="status-banner" class="banner" style="margin-bottom: 0;"></div>
    </div>

    <div id="payment-section" style="display: ${isPaid ? 'none' : 'block'};">
      <div class="timer-bar">Pay within <span id="countdown-timer">00:15:00</span></div>
      <div class="content">
        ${isBank ? `
        <div class="qris-frame" style="text-align:left;">
          <div class="qris-title">
            <span class="qris-logo" style="background:#1e3a8a;">BANK VA</span>
            <span>Midtrans Sandbox</span>
          </div>
          <p style="font-size:12px;color:#6b7280;margin:8px 0 4px;">Bank Tujuan</p>
          <p style="font-size:15px;font-weight:700;margin:0 0 12px;color:#111827;">BCA / BNI / BRI / Mandiri Virtual Account</p>
          <p style="font-size:12px;color:#6b7280;margin:0 0 4px;">Nomor Virtual Account</p>
          <p style="font-size:20px;font-weight:800;letter-spacing:1.2px;margin:0 0 8px;color:#1e3a8a;background:#eff6ff;padding:10px 12px;border-radius:8px;">${escapeHtml(vaNumber)}</p>
          <p class="qris-caption">a.n. Museum Brawijaya Malang • Transfer sesuai nominal tagihan</p>
        </div>

        <div class="guide">
          <p class="guide-title">Cara Pembayaran Transfer Bank</p>
          <ol>
            <li>Buka aplikasi <strong>Mobile Banking</strong> atau ATM (BCA, BNI, BRI, Mandiri).</li>
            <li>Pilih menu <strong>Transfer Virtual Account</strong> dan masukkan nomor <strong>${escapeHtml(vaNumber)}</strong>.</li>
            <li>Pastikan nominal <strong>${escapeHtml(formatRupiah(Number(booking.total_biaya)))}</strong> sudah sesuai, lalu konfirmasi.</li>
            <li>Klik <strong>Check status</strong> di bawah ini untuk mengaktifkan E-Tiket (<strong>LUNAS</strong>).</li>
          </ol>
        </div>
        ` : isCard ? `
        <div class="qris-frame" style="text-align:left;">
          <div class="qris-title">
            <span class="qris-logo" style="background:#7e22ce;">VISA / MC</span>
            <span>Midtrans Sandbox</span>
          </div>
          <p style="font-size:12px;color:#6b7280;margin:8px 0 4px;">Metode Pembayaran</p>
          <p style="font-size:15px;font-weight:700;margin:0 0 10px;color:#111827;">Credit / Debit Card (Visa &amp; Mastercard)</p>
          <p style="font-size:12px;color:#6b7280;margin:0 0 4px;">Nomor Rekening / Kartu</p>
          <p style="font-size:18px;font-weight:800;letter-spacing:1.2px;margin:0;color:#581c87;background:#faf5ff;border:1px solid #e9d5ff;padding:10px 12px;border-radius:8px;">4811 1111 1111 1114</p>
        </div>

        <div class="guide">
          <p class="guide-title">How to Pay (Credit / Debit Card)</p>
          <ol>
            <li>Verify your booking amount of <strong>${escapeHtml(formatRupiah(Number(booking.total_biaya)))}</strong>.</li>
            <li>Complete the <strong>Visa / Mastercard</strong> 3DS verification via Midtrans.</li>
            <li>Click <strong>Check status</strong> below to activate your E-Ticket (<strong>LUNAS</strong>).</li>
          </ol>
        </div>
        ` : `
        <div class="qris-frame">
          <div class="qris-title">
            <span class="qris-logo">QRIS</span>
            <span>Midtrans Sandbox</span>
          </div>
          <img src="${escapeHtml(qrisImgSrc)}" alt="QRIS Pembayaran Museum Brawijaya" />
          <p class="qris-caption">Dicetak oleh: GoPay / QRIS • Museum Brawijaya Malang</p>
        </div>

        <div class="guide">
          <p class="guide-title">How to pay</p>
          <ol>
            <li>Open your <strong>GoPay</strong> or <strong>other QRIS</strong> supporting payment app.</li>
            <li><strong>Download</strong> or <strong>scan QRIS</strong> on your monitor.</li>
            <li>Click <strong>Download QRIS</strong> or <strong>Check status</strong> below to confirm payment.</li>
            <li>Payment completed &amp; E-Ticket becomes <strong>LUNAS</strong>.</li>
          </ol>
        </div>

        <button id="btn-download-qris" type="button" class="btn btn-outline">Download QRIS</button>
        `}
        <button id="btn-check-status" type="button" class="btn btn-dark">Check status</button>
        ${snapUrl ? `<a class="snap-link" href="${escapeHtml(snapUrl)}" target="_blank" rel="noopener noreferrer">Buka halaman Midtrans Snap Sandbox</a>` : ''}
      </div>
    </div>

    <div id="paid-section" class="content" style="display: ${isPaid ? 'block' : 'none'};">
      <div class="paid-card">
        <div class="paid-icon">✓</div>
        <h2 class="paid-title">Pembayaran Berhasil (LUNAS)</h2>
        <p class="paid-sub">E-Tiket resmi Museum Brawijaya Anda sudah aktif dan siap digunakan.</p>

        <div class="qris-frame">
          <div class="qris-title">
            <span>QR CHECK-IN E-TIKET</span>
            <span style="color:#059669;">AKTIF</span>
          </div>
          <img src="${escapeHtml(ticketQrUrl)}" alt="QR Code E-Tiket" />
          <p class="qris-caption"><strong>${escapeHtml(booking.id)}</strong></p>
        </div>

        <div class="detail-box">
          <div class="detail-row"><span class="detail-label">Nama Pengunjung</span><span class="detail-val">${escapeHtml(booking.nama)}</span></div>
          <div class="detail-row"><span class="detail-label">Tanggal Kunjungan</span><span class="detail-val">${escapeHtml(booking.visit_date || '-')}</span></div>
          <div class="detail-row"><span class="detail-label">Sesi</span><span class="detail-val">${escapeHtml(booking.sesi || '-')}</span></div>
          <div class="detail-row"><span class="detail-label">Jumlah Tiket</span><span class="detail-val">${escapeHtml(String(booking.total_tiket))} pengunjung</span></div>
          <div class="detail-row"><span class="detail-label">Status</span><span class="detail-val" style="color:#059669;">LUNAS</span></div>
        </div>

        <a id="btn-download-pdf" class="btn btn-green" href="${escapeHtml(ticketPdfUrl)}" download>Download E-Tiket (PDF)</a>
        <button id="btn-close-window" type="button" class="btn btn-outline">Kembali ke Aplikasi</button>
      </div>
    </div>
  </div>
  <script src="/api/payment/checkout-script.js"></script>
</body>
</html>`);
};

export const handleNotification = async (req: Request, res: Response) => {
  const notification = req.body;
  if (!notification || typeof notification.transaction_id !== 'string' || !notification.transaction_id.trim()) {
    return res.status(400).json({
      success: false,
      message: 'transaction_id wajib diisi',
    });
  }

  const keys = getMidtransKeys(false);
  if (!keys) {
    logger.error('Server key Midtrans tidak lengkap atau tidak sesuai dengan mode yang dipilih');
    return res.status(503).json({
      success: false,
      message: 'Layanan pembayaran belum tersedia',
    });
  }

  try {
    const coreApi = new (midtransClient as any).CoreApi({
      isProduction: keys.isProduction,
      serverKey: keys.serverKey,
    });
    const transaction = await coreApi.transaction.notification(notification);
    const {
      order_id: orderId,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
      payment_type: paymentType,
      transaction_id: transactionId,
    } = transaction;

    if (typeof orderId !== 'string' || !orderId.startsWith('MB-')) {
      logger.warn({ orderId }, 'Notifikasi Midtrans memiliki order_id yang tidak dikenal');
      return res.status(400).json({ success: false, message: 'order_id tidak valid' });
    }

    const strippedPrefix = orderId.replace(/^MB-+/i, '');
    const bookingCandidates = Array.from(
      new Set([
        `#${orderId}`,
        `#${strippedPrefix}`,
        `#MB-${strippedPrefix.replace(/^MB-+/i, '')}`,
      ]),
    );

    let booking: Awaited<ReturnType<typeof paymentModel.findBookingByIdOrHash>> = null;
    for (const candidate of bookingCandidates) {
      const found = await paymentModel.findBookingByIdOrHash(candidate);
      if (found && isOrderIdForBooking(found.id, orderId)) {
        booking = found;
        break;
      }
    }

    if (!booking) {
      logger.warn({ orderId }, 'Booking untuk notifikasi Midtrans tidak ditemukan');
      return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
    }

    const synced = await syncBookingWithMidtransStatus({
      booking,
      orderId,
      transactionStatus: String(transactionStatus || 'pending'),
      fraudStatus: fraudStatus ? String(fraudStatus) : undefined,
      paymentType: paymentType ? String(paymentType) : undefined,
      transactionId: transactionId ? String(transactionId) : undefined,
      grossAmountRaw: transaction.gross_amount,
      req,
    });

    if (synced.amountMismatch) {
      logger.error({ orderId, bookingId: booking.id }, 'Nominal notifikasi Midtrans tidak sesuai booking');
      return res.status(400).json({ success: false, message: 'Nominal transaksi tidak sesuai' });
    }

    return res.status(200).json({
      success: true,
      message: 'Notifikasi pembayaran berhasil diproses',
      orderId,
      transactionStatus,
      bookingStatus: synced.nextBookingStatus,
    });
  } catch (error) {
    logger.error({ err: error, transactionId: notification.transaction_id }, 'Gagal memverifikasi notifikasi Midtrans');
    return res.status(500).json({
      success: false,
      message: 'Gagal memverifikasi notifikasi pembayaran',
    });
  }
};

export default {
  createTransaction,
  checkTransactionStatus,
  handleNotification,
  renderQrisCheckoutPage,
  serveCheckoutScript,
  getQrisImage,
  getTicketQrImage,
  downloadTicketPdf,
};
