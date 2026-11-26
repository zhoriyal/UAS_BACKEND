import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import midtransClient from 'midtrans-client';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { Request, Response } from 'express';
import { paymentModel } from '../models/paymentModel';
import { logger } from '../logger';

const ticketDirectory = path.resolve(__dirname, '../../storage/tickets');
const supportedBanks = new Set(['bca', 'bni', 'bri', 'mandiri', 'permata', 'cimb']);

function getMidtransConfig(requireClientKey = false) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim() || '';
  const clientKey = process.env.MIDTRANS_CLIENT_KEY?.trim() || '';
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
  const serverKeyPrefix = isProduction ? 'Mid-server-' : 'SB-Mid-server-';
  const clientKeyPrefix = isProduction ? 'Mid-client-' : 'SB-Mid-client-';
  if (
    !serverKey.startsWith(serverKeyPrefix) ||
    (requireClientKey && !clientKey.startsWith(clientKeyPrefix))
  ) {
    return null;
  }

  return {
    serverKey,
    ...(clientKey ? { clientKey } : {}),
    isProduction,
  };
}

function getPdfUrl(filename: string): string {
  const configuredUrl = process.env.PUBLIC_API_URL?.trim();
  if (process.env.NODE_ENV === 'production' && !configuredUrl) {
    throw new Error('PUBLIC_API_URL wajib diatur di production untuk tautan PDF tiket');
  }
  const baseUrl = (configuredUrl || `http://localhost:${process.env.PORT || 3001}`).replace(/\/+$/, '');
  return `${baseUrl}/api/tickets/files/${filename}`;
}

async function createTicketPdf({
  filename,
  booking,
  orderId,
  amount,
}: {
  filename: string;
  booking: any;
  orderId: string;
  amount: number;
}) {
  await fs.promises.mkdir(ticketDirectory, { recursive: true });
  const filePath = path.join(ticketDirectory, filename);
  const qrCode = await QRCode.toBuffer(orderId, { errorCorrectionLevel: 'M', margin: 1, width: 180 });

  await new Promise<void>((resolve, reject) => {
    const document = new PDFDocument({ size: 'A5', margin: 36 });
    const output = fs.createWriteStream(filePath);
    document.pipe(output);
    output.once('finish', () => resolve());
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

export const checkout = async (req: Request, res: Response) => {
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

  try {
    const booking = await paymentModel.findBookingByIdOrHash(bookingId);
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
    const user = await paymentModel.findUserByEmail(booking.email);

    const existingTicket = await paymentModel.findExistingTicketByBookingId(booking.id);
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
        const snapHost = midtransConfig.isProduction
          ? 'app.midtrans.com'
          : 'app.sandbox.midtrans.com';
        return res.json({
          success: true,
          orderId: existingTicket.order_id,
          token: existingTicket.snap_token,
          redirect_url: `https://${snapHost}/snap/v4/redirection/${encodeURIComponent(existingTicket.snap_token)}`,
        });
      }
    }

    const ticketId = crypto.randomUUID();
    const orderId = `MB-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const snap = new (midtransClient as any).Snap(midtransConfig);
    const snapTransaction = await snap.createTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: amount,
      },
      customer_details: {
        first_name: booking.nama,
        email: booking.email,
        ...(booking.phone ? { phone: booking.phone } : {}),
      },
      item_details: [
        {
          id: booking.id,
          name: `Tiket Museum Brawijaya (${booking.total_tiket} tiket)`,
          price: amount,
          quantity: 1,
        },
      ],
      ...(paymentMethod === 'QRIS'
        ? { enabled_payments: ['gopay', 'shopeepay', 'other_qris'] }
        : {
            enabled_payments: bank === 'mandiri' ? ['echannel'] : ['bca_va', 'bni_va', 'bri_va', 'permata_va', 'other_va'],
          }),
    });

    await paymentModel.createTicketAndTransaction({
      ticketId,
      bookingId: booking.id,
      orderId,
      userId: user?.id ?? null,
      userName: booking.nama,
      amount,
      paymentMethod,
      transactionId: crypto.randomUUID(),
      paymentType: paymentMethod === 'QRIS' ? 'qris' : `bank_transfer_${bank}`,
      snapToken: snapTransaction.token,
    });

    return res.status(201).json({
      success: true,
      ticketId,
      orderId,
      token: snapTransaction.token,
      redirect_url: snapTransaction.redirect_url,
    });
  } catch (error) {
    logger.error({ err: error }, 'Gagal melakukan checkout tiket');
    return res.status(500).json({ success: false, message: 'Gagal memproses pembayaran tiket' });
  }
};

export const handleWebhook = async (req: Request, res: Response) => {
  const notification = req.body;
  if (!notification || typeof notification !== 'object') {
    return res.status(400).json({ success: false, message: 'Payload webhook tidak valid' });
  }

  const midtransConfig = getMidtransConfig(false);
  if (!midtransConfig) {
    logger.error('Konfigurasi server key Midtrans belum lengkap');
    return res.status(503).json({ success: false, message: 'Layanan pembayaran belum tersedia' });
  }

  try {
    const coreApi = new (midtransClient as any).CoreApi(midtransConfig);
    const verified = await coreApi.transaction.notification(notification);
    const orderId = String(verified.order_id || '');
    const transactionStatus = String(verified.transaction_status || '');
    const fraudStatus = String(verified.fraud_status || '');
    const statusCode = String(verified.status_code || '');
    const grossAmount = String(verified.gross_amount || '');
    const signatureKey = String(verified.signature_key || '');

    const expectedSignature = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${midtransConfig.serverKey}`)
      .digest('hex');

    if (signatureKey !== expectedSignature) {
      logger.warn({ orderId }, 'Signature webhook Midtrans tidak cocok');
      return res.status(401).json({ success: false, message: 'Signature tidak valid' });
    }

    const ticket = await paymentModel.findTicketByOrderId(orderId);
    if (!ticket) {
      logger.warn({ orderId }, 'Tiket dengan order_id tersebut tidak ditemukan');
      return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });
    }

    let nextStatus: 'SUCCESS' | 'FAILED' | 'PENDING' = 'PENDING';
    if (transactionStatus === 'capture') {
      nextStatus = fraudStatus === 'challenge' ? 'PENDING' : 'SUCCESS';
    } else if (transactionStatus === 'settlement') {
      nextStatus = 'SUCCESS';
    } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
      nextStatus = 'FAILED';
    }

    let pdfUrl: string | null = null;
    if (nextStatus === 'SUCCESS') {
      const pdfFilename = `ticket-${ticket.order_id}.pdf`;
      await createTicketPdf({
        filename: pdfFilename,
        booking: {
          id: ticket.booking_id,
          nama: ticket.nama,
          visit_date: ticket.visit_date,
          sesi: ticket.sesi,
          total_tiket: ticket.total_tiket,
        },
        orderId: ticket.order_id,
        amount: ticket.amount,
      });
      pdfUrl = getPdfUrl(pdfFilename);
    }

    await paymentModel.updateTicketStatus(ticket.id, nextStatus, pdfUrl);
    await paymentModel.updateTransactionStatus(
      ticket.id,
      nextStatus,
      verified.transaction_id ? String(verified.transaction_id) : null,
    );

    if (nextStatus === 'SUCCESS') {
      await paymentModel.updateBookingStatus(ticket.booking_id, 'LUNAS');
    } else if (nextStatus === 'FAILED') {
      await paymentModel.updateBookingStatus(ticket.booking_id, 'BATAL');
    }

    return res.json({ success: true, status: nextStatus, pdfUrl });
  } catch (error) {
    logger.error({ err: error }, 'Gagal memproses webhook Midtrans');
    return res.status(500).json({ success: false, message: 'Gagal memproses notifikasi webhook' });
  }
};

export const getTicketPdf = async (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename || '');
  if (!filename.endsWith('.pdf')) {
    return res.status(400).json({ success: false, message: 'Format berkas tidak valid' });
  }

  const filePath = path.join(ticketDirectory, filename);
  try {
    await fs.promises.access(filePath);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', 'application/pdf');
    if (req.query?.download === '1' || req.query?.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    return res.sendFile(filePath);
  } catch {
    return res.status(404).json({ success: false, message: 'Berkas tiket tidak ditemukan' });
  }
};

export default {
  checkout,
  handleWebhook,
  getTicketPdf,
};
