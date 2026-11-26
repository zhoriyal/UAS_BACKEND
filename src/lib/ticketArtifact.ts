import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export const TICKET_DIRECTORY = path.resolve(__dirname, '../../storage/tickets');

export interface TicketArtifactBooking {
  id: string;
  nama: string;
  email: string;
  visit_date?: string;
  sesi?: string;
  total_tiket: number;
  total_biaya: number;
  payment_method?: string;
}

export function sanitizeArtifactKey(raw: string): string {
  return raw.replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '-');
}

export function getPublicApiBaseUrl(req?: Request): string {
  const configured = process.env.PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const host = req?.get('host')?.trim();
  if (host) {
    const forwardedProto = req?.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProto || req?.protocol || 'http';
    return `${protocol}://${host}`.replace(/\/+$/, '');
  }
  return `http://localhost:${process.env.PORT || 3001}`;
}

export function buildTicketPdfDownloadUrl(bookingId: string, req?: Request): string {
  const baseUrl = getPublicApiBaseUrl(req);
  return `${baseUrl}/api/payment/ticket-pdf/${encodeURIComponent(bookingId)}`;
}

export function buildTicketQrImageUrl(bookingId: string, req?: Request): string {
  const baseUrl = getPublicApiBaseUrl(req);
  return `${baseUrl}/api/payment/ticket-qr/${encodeURIComponent(bookingId)}`;
}

export function buildQrisImageUrl(bookingId: string, req?: Request): string {
  const baseUrl = getPublicApiBaseUrl(req);
  return `${baseUrl}/api/payment/qris-image/${encodeURIComponent(bookingId)}`;
}

export function buildQrisCheckoutUrl(bookingId: string, req?: Request): string {
  const baseUrl = getPublicApiBaseUrl(req);
  return `${baseUrl}/api/payment/checkout/${encodeURIComponent(bookingId)}`;
}

export function buildSandboxQrisPayload(params: {
  bookingId: string;
  orderId: string;
  amount: number;
  nama: string;
}): string {
  // Payload terstruktur untuk QRIS Sandbox Museum Brawijaya (dapat di-scan / diunduh)
  return [
    '000201010212',
    '26580016ID.CO.MIDTRANS.WWW01189360091430000000000215MUSEUMBRAWIJAYA',
    '52047991',
    '5303360',
    `54${String(String(params.amount).length).padStart(2, '0')}${params.amount}`,
    '5802ID',
    '5916MUSEUM BRAWIJAYA',
    '6006MALANG',
    `62${String(params.orderId.length + 4).padStart(2, '0')}05${String(params.orderId.length).padStart(2, '0')}${params.orderId}`,
  ].join('');
}

export async function generateQrisPngBuffer(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: {
      dark: '#1F2937',
      light: '#FFFFFF',
    },
  });
}

export async function generateTicketQrPngBuffer(bookingId: string): Promise<Buffer> {
  return QRCode.toBuffer(bookingId, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 260,
    color: {
      dark: '#26362A',
      light: '#FFFFFF',
    },
  });
}

export async function ensureTicketPdf(params: {
  booking: TicketArtifactBooking;
  orderId: string;
  amount: number;
  req?: Request;
}): Promise<{ filename: string; filePath: string; pdfUrl: string; staticFileUrl: string }> {
  const { booking, orderId, amount, req } = params;
  const safeKey = sanitizeArtifactKey(orderId || booking.id);
  const filename = `ticket-${safeKey}.pdf`;
  const filePath = path.join(TICKET_DIRECTORY, filename);

  await fs.promises.mkdir(TICKET_DIRECTORY, { recursive: true });
  const qrBuffer = await generateTicketQrPngBuffer(booking.id);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 32 });
    const output = fs.createWriteStream(filePath);
    doc.pipe(output);
    output.once('finish', () => resolve());
    output.once('error', reject);
    doc.once('error', reject);

    // Header banner
    doc.rect(0, 0, doc.page.width, 82).fill('#26362A');
    doc
      .fillColor('#CBB26A')
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('E-TIKET RESMI KUNJUNGAN', 32, 22, { align: 'center' });
    doc
      .fillColor('#FFFFFF')
      .fontSize(17)
      .font('Helvetica-Bold')
      .text('MUSEUM BRAWIJAYA MALANG', 32, 38, { align: 'center' });
    doc
      .fillColor('#D1FAE5')
      .fontSize(9)
      .font('Helvetica')
      .text('STATUS PEMBAYARAN: LUNAS', 32, 60, { align: 'center' });

    // Body details
    doc.y = 102;
    doc.fillColor('#1F2937').font('Helvetica-Bold').fontSize(12).text(`Kode Booking: ${booking.id}`);
    doc.moveDown(0.35);

    const rows: Array<[string, string]> = [
      ['Nomor Pesanan', orderId],
      ['Nama Pengunjung', booking.nama],
      ['Email', booking.email],
      ['Tanggal Kunjungan', booking.visit_date || '-'],
      ['Sesi Kunjungan', booking.sesi || '-'],
      ['Jumlah Tiket', `${booking.total_tiket} Pengunjung`],
      ['Metode Bayar', booking.payment_method || 'QRIS'],
      ['Total Pembayaran', `Rp ${Number(amount).toLocaleString('id-ID')}`],
      ['Status', 'LUNAS'],
    ];

    doc.fontSize(10);
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font('Helvetica').fillColor('#6B7280').text(label, 32, y, { width: 130 });
      doc.font('Helvetica-Bold').fillColor('#111827').text(value, 165, y, {
        width: doc.page.width - 197,
        align: 'right',
      });
      doc.moveDown(0.45);
    }

    doc.moveDown(0.4);
    const qrSize = 132;
    const qrX = (doc.page.width - qrSize) / 2;
    const qrY = doc.y;
    doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
    doc.y = qrY + qrSize + 10;

    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor('#26362A')
      .text(booking.id, { align: 'center' });
    doc.moveDown(0.3);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#6B7280')
      .text(
        'Tunjukkan QR Code atau E-Tiket PDF ini kepada petugas loket masuk Museum Brawijaya (Jl. Ijen No.25A, Kota Malang).',
        32,
        doc.y,
        { align: 'center', width: doc.page.width - 64 },
      );

    doc.end();
  });

  const baseUrl = getPublicApiBaseUrl(req);
  return {
    filename,
    filePath,
    pdfUrl: buildTicketPdfDownloadUrl(booking.id, req),
    staticFileUrl: `${baseUrl}/api/tickets/files/${encodeURIComponent(filename)}`,
  };
}
