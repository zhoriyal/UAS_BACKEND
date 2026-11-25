import { Router, Request, Response } from 'express';
import express from 'express';
import { uploadFile, createSecureDownloadUrl, deleteFileByUrl } from '../lib/cloudStorage';
import authMiddleware from '../middleware/authMiddleware';
import prisma from '../lib/prisma';
import pino from 'pino';

const logger = pino({ name: 'storage' });
const router = Router();

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Middleware parsing raw binary image body (misalnya file langsung dikirim dari fetch / HTTP client)
const rawImageParser = express.raw({
  type: ['image/*', 'application/octet-stream', 'application/pdf'],
  limit: '10mb',
});

// Deteksi format gambar asli melalui magic bytes untuk mencegah upload berkas tidak valid
function detectImageFromMagicBytes(buffer: Buffer): { mimeType: string; ext: string } | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: 'image/png', ext: 'png' };
  }

  // WebP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }

  return null;
}

// Helper untuk mengekstrak Buffer dari raw binary maupun json base64
function extractBufferAndType(req: Request): { buffer: Buffer | null; contentType: string } {
  let buffer: Buffer | null = null;
  let contentType = req.get('content-type') || 'image/jpeg';

  if (Buffer.isBuffer(req.body)) {
    buffer = req.body;
  } else if (req.body && typeof req.body.imageBase64 === 'string') {
    const dataUriMatch = req.body.imageBase64.match(/^data:([^;]+);base64,/i);
    if (dataUriMatch?.[1]) {
      contentType = dataUriMatch[1];
    }
    const base64Data = req.body.imageBase64.replace(/^data:[^;]+;base64,/i, '');
    buffer = Buffer.from(base64Data, 'base64');
    if (typeof req.body.contentType === 'string' && req.body.contentType.trim()) {
      contentType = req.body.contentType.trim();
    }
  }

  // Bersihkan parameter charset jika ada (misal "image/jpeg; charset=utf-8")
  if (contentType.includes(';')) {
    contentType = contentType.split(';')[0].trim();
  }
  contentType = contentType.toLowerCase();
  if (contentType === 'image/jpg') {
    contentType = 'image/jpeg';
  }

  return { buffer, contentType };
}

/**
 * POST /storage/uploads
 * Digunakan oleh admin Koleksi (PBL_ADMIN) maupun client lain untuk upload gambar umum ke Vercel Blob
 */
router.post('/uploads', rawImageParser, async (req: Request, res: Response) => {
  try {
    const { buffer, contentType } = extractBufferAndType(req);

    if (!buffer || buffer.length === 0) {
      res.status(400).json({ success: false, message: 'Berkas gambar tidak ditemukan dalam request body' });
      return;
    }

    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      res.status(400).json({ success: false, message: 'Ukuran berkas maksimal 5 MB' });
      return;
    }

    const detected = detectImageFromMagicBytes(buffer);
    const finalMime = detected?.mimeType ?? contentType;
    if (!ALLOWED_IMAGE_MIME_TYPES.has(finalMime)) {
      res.status(400).json({ success: false, message: 'Format gambar harus JPG, PNG, atau WebP' });
      return;
    }

    const ext = detected?.ext ?? (finalMime === 'image/png' ? 'png' : finalMime === 'image/webp' ? 'webp' : 'jpg');
    const filename = `collections/koleksi-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const blob = await uploadFile({
      pathname: filename,
      body: buffer,
      contentType: finalMime,
      access: 'public',
    });

    logger.info({ pathname: blob.pathname, url: blob.url }, 'Berhasil upload file koleksi ke Vercel Blob');

    res.status(200).json({
      success: true,
      message: 'File berhasil diunggah ke Vercel Blob',
      data: {
        pathname: blob.pathname,
        url: blob.url,
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Gagal mengunggah file koleksi ke Vercel Blob');
    res.status(500).json({
      success: false,
      message: error?.message || 'Gagal mengunggah file ke penyimpanan cloud',
    });
  }
});

/**
 * POST /storage/avatar
 * Digunakan oleh aplikasi pengunjung (User_Mobile) maupun panel admin (PBL_ADMIN)
 * untuk upload foto profil ke Vercel Blob & simpan URL ke database MySQL
 */
router.post('/avatar', authMiddleware, rawImageParser, async (req: Request, res: Response) => {
  try {
    const identity = req.user;
    if (!identity || !identity.id) {
      res.status(401).json({ success: false, message: 'Autentikasi diperlukan. Silakan login kembali.' });
      return;
    }

    const { buffer } = extractBufferAndType(req);

    if (!buffer || buffer.length === 0) {
      res.status(400).json({ success: false, message: 'Berkas foto profil tidak ditemukan dalam permintaan' });
      return;
    }

    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      res.status(400).json({ success: false, message: 'Ukuran foto profil maksimal 5 MB' });
      return;
    }

    const detected = detectImageFromMagicBytes(buffer);
    if (!detected || !ALLOWED_IMAGE_MIME_TYPES.has(detected.mimeType)) {
      res.status(400).json({
        success: false,
        message: 'Format foto profil tidak didukung. Gunakan gambar JPG, PNG, atau WebP.',
      });
      return;
    }

    const isAdmin =
      identity.accountType === 'ADMIN' ||
      (identity.accountType !== 'USER' && identity.role.toUpperCase() !== 'USER');

    if (isAdmin) {
      const adminUsername = identity.username ?? identity.email;
      const existingAdmin =
        (await prisma.admin.findUnique({ where: { id: identity.id } })) ??
        (adminUsername ? await prisma.admin.findUnique({ where: { username: adminUsername } }) : null);

      if (!existingAdmin) {
        res.status(404).json({ success: false, message: 'Akun admin tidak ditemukan di database.' });
        return;
      }

      const filename = `avatars/admin-${existingAdmin.id}-${Date.now()}.${detected.ext}`;
      const blob = await uploadFile({
        pathname: filename,
        body: buffer,
        contentType: detected.mimeType,
        access: 'public',
      });

      const updatedAdmin = await prisma.admin.update({
        where: { id: existingAdmin.id },
        data: { avatarUrl: blob.url },
      });

      // Sinkronkan juga ke tabel users jika akun STAFF memiliki email yang sama
      await prisma.user
        .updateMany({
          where: { email: existingAdmin.username },
          data: { avatarUrl: blob.url },
        })
        .catch(() => undefined);

      if (existingAdmin.avatarUrl && existingAdmin.avatarUrl !== blob.url) {
        void deleteFileByUrl(existingAdmin.avatarUrl);
      }

      logger.info(
        { adminId: existingAdmin.id, avatarUrl: blob.url },
        'Foto profil admin berhasil diunggah ke Vercel Blob dan disimpan ke database',
      );

      res.status(200).json({
        success: true,
        message: 'Foto profil admin berhasil diunggah dan diperbarui',
        data: {
          pathname: blob.pathname,
          url: blob.url,
          avatarUrl: blob.url,
          user: {
            id: updatedAdmin.id,
            nama: updatedAdmin.nama,
            username: updatedAdmin.username,
            email: updatedAdmin.username,
            avatarUrl: updatedAdmin.avatarUrl,
            jabatan: updatedAdmin.jabatan,
            phone: updatedAdmin.phone,
            role: updatedAdmin.role,
            createdAt: updatedAdmin.createdAt,
          },
        },
      });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { id: identity.id } });
    if (!existingUser) {
      res.status(404).json({ success: false, message: 'Akun pengguna tidak ditemukan di database.' });
      return;
    }

    const filename = `avatars/user-${existingUser.id}-${Date.now()}.${detected.ext}`;

    const blob = await uploadFile({
      pathname: filename,
      body: buffer,
      contentType: detected.mimeType,
      access: 'public',
    });

    // Simpan URL foto profil ke kolom avatar_url pada tabel users di MySQL
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: { avatarUrl: blob.url },
    });

    // Hapus blob avatar lama secara asinkron (best-effort) agar penyimpanan tetap rapi
    if (existingUser.avatarUrl && existingUser.avatarUrl !== blob.url) {
      void deleteFileByUrl(existingUser.avatarUrl);
    }

    logger.info({ userId: existingUser.id, avatarUrl: blob.url }, 'Foto profil berhasil diunggah dan disimpan ke database');

    res.status(200).json({
      success: true,
      message: 'Foto profil berhasil diunggah dan diperbarui',
      data: {
        pathname: blob.pathname,
        url: blob.url,
        avatarUrl: blob.url,
        user: {
          id: updatedUser.id,
          nama: updatedUser.nama,
          email: updatedUser.email,
          avatarUrl: updatedUser.avatarUrl,
          role: updatedUser.role,
          authProvider: updatedUser.authProvider,
          createdAt: updatedUser.createdAt,
        },
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Gagal mengunggah foto profil');
    res.status(500).json({
      success: false,
      message: error?.message || 'Gagal mengunggah foto profil',
    });
  }
});

/**
 * DELETE /storage/avatar
 * Menghapus foto profil pengguna/admin di database MySQL (avatar_url = null) & membersihkan Vercel Blob lama
 */
router.delete('/avatar', authMiddleware, async (req: Request, res: Response) => {
  try {
    const identity = req.user;
    if (!identity || !identity.id) {
      res.status(401).json({ success: false, message: 'Autentikasi diperlukan. Silakan login kembali.' });
      return;
    }

    const isAdmin =
      identity.accountType === 'ADMIN' ||
      (identity.accountType !== 'USER' && identity.role.toUpperCase() !== 'USER');

    if (isAdmin) {
      const adminUsername = identity.username ?? identity.email;
      const existingAdmin =
        (await prisma.admin.findUnique({ where: { id: identity.id } })) ??
        (adminUsername ? await prisma.admin.findUnique({ where: { username: adminUsername } }) : null);

      if (!existingAdmin) {
        res.status(404).json({ success: false, message: 'Akun admin tidak ditemukan di database.' });
        return;
      }

      const oldAvatarUrl = existingAdmin.avatarUrl;
      const updatedAdmin = await prisma.admin.update({
        where: { id: existingAdmin.id },
        data: { avatarUrl: null },
      });

      await prisma.user
        .updateMany({
          where: { email: existingAdmin.username },
          data: { avatarUrl: null },
        })
        .catch(() => undefined);

      if (oldAvatarUrl) {
        void deleteFileByUrl(oldAvatarUrl);
      }

      res.status(200).json({
        success: true,
        message: 'Foto profil admin berhasil dihapus',
        data: {
          avatarUrl: null,
          user: {
            id: updatedAdmin.id,
            nama: updatedAdmin.nama,
            username: updatedAdmin.username,
            email: updatedAdmin.username,
            avatarUrl: updatedAdmin.avatarUrl,
            jabatan: updatedAdmin.jabatan,
            phone: updatedAdmin.phone,
            role: updatedAdmin.role,
            createdAt: updatedAdmin.createdAt,
          },
        },
      });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { id: identity.id } });
    if (!existingUser) {
      res.status(404).json({ success: false, message: 'Akun pengguna tidak ditemukan di database.' });
      return;
    }

    const oldAvatarUrl = existingUser.avatarUrl;
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: { avatarUrl: null },
    });

    if (oldAvatarUrl) {
      void deleteFileByUrl(oldAvatarUrl);
    }

    res.status(200).json({
      success: true,
      message: 'Foto profil berhasil dihapus',
      data: {
        avatarUrl: null,
        user: {
          id: updatedUser.id,
          nama: updatedUser.nama,
          email: updatedUser.email,
          avatarUrl: updatedUser.avatarUrl,
          role: updatedUser.role,
          authProvider: updatedUser.authProvider,
          createdAt: updatedUser.createdAt,
        },
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Gagal menghapus foto profil');
    res.status(500).json({
      success: false,
      message: error?.message || 'Gagal menghapus foto profil',
    });
  }
});

/**
 * POST /storage/private-uploads (kompatibilitas PBL_ADMIN)
 */
router.post('/private-uploads', rawImageParser, async (req: Request, res: Response) => {
  try {
    const { buffer, contentType } = extractBufferAndType(req);

    if (!buffer || buffer.length === 0) {
      res.status(400).json({ success: false, message: 'Berkas tidak ditemukan' });
      return;
    }

    const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';
    const filename = `private/doc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const blob = await uploadFile({
      pathname: filename,
      body: buffer,
      contentType,
      access: 'private',
    });

    res.status(200).json({
      success: true,
      data: { pathname: blob.pathname },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error?.message || 'Gagal upload privat' });
  }
});

/**
 * POST /storage/secure-url (kompatibilitas PBL_ADMIN)
 */
router.post('/secure-url', async (req: Request, res: Response) => {
  try {
    const { pathname } = req.body || {};
    if (!pathname) {
      res.status(400).json({ success: false, message: 'pathname wajib disertakan' });
      return;
    }

    const url = await createSecureDownloadUrl(pathname);
    res.json({
      success: true,
      data: { url, expiresIn: 300 },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error?.message || 'Gagal membuat URL aman' });
  }
});

export default router;
