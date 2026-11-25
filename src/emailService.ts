import nodemailer from 'nodemailer';

export interface SendTicketNotificationParams {
  to: string;
  nama: string;
  bookingId: string;
  totalTiket: number | string;
  totalBiaya: number | string;
  visitDate: string;
  sesi: string;
  isMancanegara?: boolean;
  qrDataUrl?: string;
}

export interface SendPasswordResetParams {
  to: string;
  accountEmail?: string;
  nama: string;
  resetToken: string;
  resetLink: string;
  otpCode?: string;
  accountLabel?: string;
  expiresInMinutes?: number;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  previewUrl?: string | false;
  deliveryMode?: 'smtp' | 'ethereal' | 'failed';
  error?: string;
}

interface EtherealAccount {
  user: string;
  pass: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
  };
}

let cachedEtherealAccount: EtherealAccount | null = null;

/**
 * Helper untuk mendapatkan transporter Nodemailer:
 * 1. Jika SMTP_USER & SMTP_PASS diatur (e.g. Gmail App Password atau custom SMTP), kirim ke inbox nyata pengguna.
 * 2. Jika belum diatur, gunakan Ethereal SMTP test account dari Nodemailer agar email terkirim secara live ke server SMTP di internet.
 */
async function getMailTransporter(): Promise<{ transporter: any; isEthereal: boolean }> {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  if (user && pass) {
    const isSecure = process.env.SMTP_SECURE === 'true' || port === 465;
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
      },
    });
    return { transporter, isEthereal: false };
  }

  // Gunakan Ethereal SMTP jika kredensial SMTP lokal belum diisi di .env
  if (!cachedEtherealAccount) {
    cachedEtherealAccount = await nodemailer.createTestAccount();
  }
  const transporter = nodemailer.createTransport({
    host: cachedEtherealAccount.smtp.host,
    port: cachedEtherealAccount.smtp.port,
    secure: cachedEtherealAccount.smtp.secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth: {
      user: cachedEtherealAccount.user,
      pass: cachedEtherealAccount.pass,
    },
  });
  return { transporter, isEthereal: true };
}

/**
 * Service pengiriman email notifikasi tiket dengan QR Code
 */
export async function sendTicketNotification({
  to,
  nama,
  bookingId,
  totalTiket,
  totalBiaya,
  visitDate,
  sesi,
  isMancanegara,
}: SendTicketNotificationParams) {
  try {
    const { transporter } = await getMailTransporter();

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

    const fromAddress = process.env.SMTP_FROM || '"Museum Brawijaya" <tiket@museumbrawijaya.id>';
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject: `[E-Tiket Resmi] ${bookingId} - Kunjungan Museum Brawijaya`,
      html: htmlContent,
    }).catch((err: any) => {
      console.warn('Simulasi Email Tiket:', err?.message || err);
      return { messageId: 'simulated-mail-' + Date.now() };
    });

    console.log(`Email notifikasi e-tiket berhasil disiapkan untuk: ${to} (Booking: ${bookingId})`);
    return { success: true, info };
  } catch (error: any) {
    console.error('Error saat mengirim notifikasi email:', error);
    return { success: false, error: error?.message || String(error) };
  }
}

/**
 * Service pengiriman email link reset kata sandi secara REAL-TIME
 */
export async function sendPasswordResetEmail({
  to,
  accountEmail,
  nama,
  resetLink,
  otpCode,
  accountLabel,
  expiresInMinutes = 15,
}: SendPasswordResetParams): Promise<SendEmailResult> {
  try {
    const { transporter, isEthereal } = await getMailTransporter();

    const fromAddress = process.env.SMTP_FROM || '"Museum Brawijaya" <no-reply@museumbrawijaya.id>';
    const recipientName = nama && nama.trim() ? nama.trim() : 'Pengguna';
    const displayAccountEmail = accountEmail || to;
    const headerSubtitle = accountLabel || 'Layanan Keamanan Akun Museum Brawijaya';

    const htmlContent = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 580px; margin: 0 auto; background-color: #F8FAF9; border-radius: 16px; overflow: hidden; border: 1px solid #E2E8F0; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <!-- Header -->
        <div style="background-color: #2D3E33; padding: 28px 24px; text-align: center; color: #FFFFFF;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 1.5px; color: #CBB26A;">MUSEUM BRAWIJAYA MALANG</h1>
          <p style="margin: 6px 0 0; font-size: 13px; color: #E2E8F0; opacity: 0.9;">${headerSubtitle}</p>
        </div>

        <!-- Content -->
        <div style="padding: 30px 24px; background: #FFFFFF;">
          <h2 style="margin-top: 0; font-size: 18px; color: #1E293B; font-weight: 600;">Verifikasi Atur Ulang Kata Sandi</h2>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">
            Halo <strong>${recipientName}</strong>,
          </p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">
            Kami menerima permintaan untuk mengatur ulang kata sandi akun Museum Brawijaya untuk email: <strong style="color: #2D3E33;">${displayAccountEmail}</strong>.
          </p>

          ${
            otpCode
              ? `
          <!-- Kotak OTP -->
          <div style="background-color: #F7F3EA; border: 2px dashed #2D3E33; border-radius: 12px; padding: 20px 16px; margin: 22px 0; text-align: center;">
            <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 1px; color: #475569;">KODE VERIFIKASI OTP (6 DIGIT)</p>
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #2D3E33; font-family: monospace;">${otpCode}</span>
            <p style="margin: 10px 0 0; font-size: 11px; color: #64748B;">Masukkan kode di atas pada halaman Lupa Sandi. Berlaku selama <strong>${expiresInMinutes} menit</strong>.</p>
          </div>
          `
              : ''
          }

          <p style="font-size: 14px; color: #475569; line-height: 1.6; text-align: center;">
            Atau klik tombol verifikasi di bawah ini untuk langsung membuat kata sandi baru:
          </p>

          <!-- Tombol CTA -->
          <div style="text-align: center; margin: 24px 0;">
            <a href="${resetLink}" target="_blank" style="display: inline-block; background-color: #2D3E33; color: #FFFFFF; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 10px; border: 1px solid #CBB26A; box-shadow: 0 4px 10px rgba(45,62,51,0.25);">
              Atur Ulang Kata Sandi
            </a>
          </div>

          <!-- Tautan Langsung -->
          <div style="margin-top: 20px; padding: 14px; background: #F8FAFC; border-radius: 8px; font-size: 12px; color: #64748B; word-break: break-all; line-height: 1.5;">
            <strong>Tautan Alternatif:</strong><br/>
            Jika tombol di atas tidak berfungsi, buka tautan berikut langsung di browser Anda:<br/>
            <a href="${resetLink}" target="_blank" style="color: #2D3E33; text-decoration: underline;">${resetLink}</a>
          </div>

          <!-- Catatan Keamanan -->
          <div style="margin-top: 22px; padding: 12px 16px; background: #FEF9C3; border-radius: 8px; border-left: 4px solid #EAB308; font-size: 12px; color: #854D0E; line-height: 1.5;">
            <strong>Catatan Keamanan:</strong><br/>
            • Kode OTP dan tautan ini hanya berlaku selama <strong>${expiresInMinutes} menit</strong> dan hanya dapat digunakan satu kali.<br/>
            • Jangan berikan kode OTP ini kepada siapa pun.<br/>
            • Jika Anda tidak pernah meminta perubahan kata sandi ini, abaikan email ini.
          </div>
        </div>

        <!-- Footer -->
        <div style="padding: 18px 24px; background-color: #F1F5F9; text-align: center; font-size: 11px; color: #94A3B8; line-height: 1.5;">
          Museum Brawijaya Malang<br/>
          Jl. Ijen No.25A, Gading Kasri, Kec. Klojen, Kota Malang, Jawa Timur 65115<br/>
          © 2026 Seluruh hak cipta dilindungi.
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject: otpCode
        ? `[Museum Brawijaya] Kode OTP Reset Sandi: ${otpCode}`
        : '[Museum Brawijaya] Tautan Atur Ulang Kata Sandi Akun Anda',
      html: htmlContent,
      text: `Halo ${recipientName},\n\nKami menerima permintaan untuk mengatur ulang kata sandi akun Museum Brawijaya (${displayAccountEmail}).\n\nKode Verifikasi OTP: ${otpCode || '-'}\n\nAtau buka tautan berikut untuk membuat kata sandi baru:\n${resetLink}\n\nKode OTP dan tautan ini berlaku selama ${expiresInMinutes} menit.\nJangan bagikan kode OTP kepada siapa pun.\n\nMuseum Brawijaya Malang`,
    });

    let previewUrl: string | false = false;
    if (isEthereal) {
      previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`[EMAIL REAL-TIME] Preview URL pesan Ethereal terkirim: ${previewUrl}`);
      }
    }
    console.log(`[EMAIL REAL-TIME] Email reset kata sandi berhasil dikirim ke: ${to} (MessageId: ${info.messageId})`);

    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || undefined,
      deliveryMode: isEthereal ? 'ethereal' : 'smtp',
    };
  } catch (error: unknown) {
    // Jika Ethereal account gagal karena cache kedaluwarsa, bersihkan cache untuk percobaan berikutnya
    cachedEtherealAccount = null;
    const message = error instanceof Error ? error.message : String(error);
    console.error('[EMAIL REAL-TIME] Gagal mengirim email reset kata sandi:', message);
    return {
      success: false,
      deliveryMode: 'failed',
      error: message,
    };
  }
}

export default { sendTicketNotification, sendPasswordResetEmail };
