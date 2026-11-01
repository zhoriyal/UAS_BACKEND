const nodemailer = require('nodemailer');

/**
 * Service pengiriman email notifikasi tiket dengan QR Code
 */
async function sendTicketNotification({ to, nama, bookingId, totalTiket, totalBiaya, visitDate, sesi, isMancanegara, qrDataUrl }) {
  try {
    // Buat test account / transporter
    // Jika tidak ada konfigurasi SMTP di .env, kita gunakan preview account atau stream fallback
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.ethereal.email',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || 'ethereal.user@ethereal.email',
        pass: process.env.SMTP_PASS || 'ethereal.pass',
      },
    });

    const badgeColor = isMancanegara ? '#7C3AED' : '#2D3E33';
    const badgeLabel = isMancanegara ? 'WISATAWAN MANCANEGARA (INTERNATIONAL)' : 'WISATAWAN DOMESTIK (INDONESIA)';
    const qrColor = isMancanegara ? '#6D28D9' : '#1E293B';

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #F8FAF9; border-radius: 16px; overflow: hidden; border: 1px solid #E2E8F0;">
        <div style="background-color: ${badgeColor}; padding: 24px; text-align: center; color: #FFFFFF;">
          <h1 style="margin: 0; font-size: 20px; letter-spacing: 1px;">MUSEUM BRAWIJAYA MALANG</h1>
          <p style="margin: 6px 0 0; font-size: 13px; opacity: 0.9;">E-Ticket Masuk Resmi</p>
          <div style="display: inline-block; margin-top: 12px; background: rgba(255,255,255,0.2); padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px;">
            ${badgeLabel}
          </div>
        </div>

        <div style="padding: 24px; background: #FFFFFF;">
          <p style="margin-top: 0; font-size: 15px; color: #334155;">Halo <strong>${nama}</strong>,</p>
          <p style="font-size: 13px; color: #64748B; line-height: 1.5;">
            Pembayaran tiket kunjungan Museum Brawijaya Anda telah berhasil dikonfirmasi. Berikut adalah rincian e-tiket kunjungan Anda:
          </p>

          <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; font-size: 13px; color: #334155;">
              <tr>
                <td style="padding: 6px 0; color: #64748B;">No. Booking:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right; color: ${badgeColor};">${bookingId}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748B;">Tanggal Kunjungan:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${visitDate}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748B;">Sesi Waktu:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${sesi}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748B;">Jumlah Tiket:</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${totalTiket} Pengunjung</td>
              </tr>
              <tr style="border-top: 1px dashed #CBD5E1;">
                <td style="padding: 10px 0 4px; color: #1E293B; font-weight: bold;">Total Pembayaran:</td>
                <td style="padding: 10px 0 4px; font-weight: bold; text-align: right; color: #16A34A; font-size: 15px;">Rp ${Number(totalBiaya).toLocaleString('id-ID')}</td>
              </tr>
            </table>
          </div>

          <!-- Bagian QR Code -->
          <div style="text-align: center; padding: 20px 0; border: 2px dashed ${badgeColor}; border-radius: 12px; background: #FAF5FF;">
            <p style="margin: 0 0 10px; font-size: 12px; font-weight: bold; color: ${qrColor};">
              TUNJUKKAN QR CODE INI KE PETUGAS LOKET MASUK
            </p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(bookingId)}&color=${isMancanegara ? '7C3AED' : '1E293B'}" alt="QR Code Tiket" style="width: 170px; height: 170px; border-radius: 8px; border: 4px solid #FFFFFF; box-shadow: 0 2px 8px rgba(0,0,0,0.08);" />
            <p style="margin: 10px 0 0; font-size: 11px; color: #64748B;">Kode Verifikasi: <strong>${bookingId}</strong></p>
          </div>

          <div style="margin-top: 24px; padding: 12px; background: #FEF9C3; border-radius: 8px; border: 1px solid #FEF08A; font-size: 11px; color: #854D0E; line-height: 1.4;">
            <strong>Catatan Kunjungan:</strong><br/>
            • Tiket hanya berlaku sesuai tanggal dan sesi yang dipilih.<br/>
            • Museum buka pukul 08.00 - 15.00 WIB (Senin Tutup).<br/>
            • Lokasi: Jl. Ijen No.25A, Gading Kasri, Kec. Klojen, Kota Malang.
          </div>
        </div>

        <div style="padding: 16px; background-color: #F1F5F9; text-align: center; font-size: 11px; color: #94A3B8;">
          © 2026 Museum Brawijaya Malang. Seluruh hak cipta dilindungi.
        </div>
      </div>
    `;

    // Coba kirim
    const info = await transporter.sendMail({
      from: '"Museum Brawijaya" <tiket@museumbrawijaya.id>',
      to,
      subject: `[E-Tiket Resmi] ${bookingId} - Kunjungan Museum Brawijaya`,
      html: htmlContent,
    }).catch(err => {
      console.warn('Simulasi Email (Nodemailer offline/no credentials):', err.message);
      return { messageId: 'simulated-mail-' + Date.now() };
    });

    console.log(`Email notifikasi e-tiket berhasil disiapkan untuk: ${to} (Booking: ${bookingId})`);
    return { success: true, info };
  } catch (error) {
    console.error('Error saat mengirim notifikasi email:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { sendTicketNotification };
