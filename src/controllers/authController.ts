import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';
import type { Request, RequestHandler, Response } from 'express';
import prisma from '../lib/prisma';
import { getJwtSecret } from '../lib/jwtSecret';
import { isNonEmptyString, isValidEmail, sanitizeString } from '../lib/validate';
import { validatePasswordStrength } from '../lib/validatePassword';
import { sendPasswordResetEmail } from '../emailService';
import { deleteFileByUrl } from '../lib/cloudStorage';
import {
  getPublicGoogleClientId,
  GoogleAuthError,
  verifyGoogleCredentials,
} from '../lib/googleAuth';

interface AuthBody {
  [key: string]: unknown;
}

interface AuthAccount {
  id: number;
  nama: string;
  passwordHash: string;
  role: string;
  accountType: 'USER' | 'ADMIN';
  username?: string;
  email?: string;
  avatarUrl?: string | null;
  jabatan?: string | null;
  phone?: string | null;
  authProvider?: string;
  createdAt?: Date;
}

function getBody(req: Request): AuthBody {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {};
  }

  return body as AuthBody;
}

function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

export const register = asyncHandler(async (req, res) => {
  const body = getBody(req);
  const nama = sanitizeString(body.nama);
  const email = isValidEmail(body.email) ? body.email.trim().toLowerCase() : '';
  const password = body.password;
  const requestedRole = body.role;

  if (!nama) {
    res.status(400).json({ success: false, message: 'Nama lengkap wajib diisi' });
    return;
  }

  if (!email) {
    res.status(400).json({ success: false, message: 'Format email tidak valid' });
    return;
  }

  const passwordCheck = validatePasswordStrength(password);
  if (!passwordCheck.valid || typeof password !== 'string') {
    res.status(400).json({ success: false, message: passwordCheck.message });
    return;
  }

  if (requestedRole !== undefined && typeof requestedRole !== 'string') {
    res.status(400).json({ success: false, message: 'Role pendaftaran tidak valid' });
    return;
  }

  const role = requestedRole === undefined ? 'USER' : sanitizeString(requestedRole).toUpperCase();
  if (role !== 'USER' && role !== 'STAFF') {
    res.status(400).json({ success: false, message: 'Role pendaftaran tidak valid' });
    return;
  }

  const [existingUser, existingAdmin] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.admin.findUnique({ where: { username: email } }),
  ]);
  if (existingUser || existingAdmin) {
    res.status(409).json({ success: false, message: 'Email sudah terdaftar. Silakan login.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.user.create({
        data: { nama, email, passwordHash, role },
      });

      if (role === 'STAFF') {
        await transaction.admin.create({
          data: { username: email, passwordHash, nama, role },
        });
      }

      return createdUser;
    });

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        nama: user.nama,
        role: user.role,
        accountType: 'USER',
      },
      getJwtSecret(),
      { expiresIn: '24h' },
    );

    res.status(201).json({
      success: true,
      message: 'Pendaftaran berhasil. Silakan login dengan akun Anda.',
      data: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        authProvider: user.authProvider,
        createdAt: user.createdAt,
        token,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ success: false, message: 'Email sudah terdaftar. Silakan login.' });
      return;
    }

    throw error;
  }
});

export const login = asyncHandler(async (req, res) => {
  const body = getBody(req);
  const credentialValue = isNonEmptyString(body.username) ? body.username : body.email;
  const password = body.password;

  if (!isNonEmptyString(credentialValue) || !isNonEmptyString(password)) {
    res.status(400).json({
      success: false,
      message: 'Username / email dan password wajib diisi',
    });
    return;
  }

  const credential = credentialValue.trim().toLowerCase();
  const admin = await prisma.admin.findUnique({
    where: { username: credential },
  });
  const adminAlias = !admin && credential === 'admin@museum.com'
    ? await prisma.admin.findUnique({ where: { username: 'admin' } })
    : null;
  const matchedAdmin = admin ?? adminAlias;

  let account: AuthAccount | null = matchedAdmin
    ? {
        id: matchedAdmin.id,
        nama: matchedAdmin.nama,
        passwordHash: matchedAdmin.passwordHash,
        role: matchedAdmin.role,
        accountType: 'ADMIN',
        username: matchedAdmin.username,
        avatarUrl: matchedAdmin.avatarUrl,
        jabatan: matchedAdmin.jabatan,
        phone: matchedAdmin.phone,
        createdAt: matchedAdmin.createdAt,
      }
    : null;

  if (!account && isValidEmail(credential)) {
    const user = await prisma.user.findUnique({ where: { email: credential } });
    if (user?.passwordHash) {
      account = {
        id: user.id,
        nama: user.nama,
        passwordHash: user.passwordHash,
        role: user.role,
        accountType: 'USER',
        email: user.email,
        avatarUrl: user.avatarUrl,
        authProvider: user.authProvider,
        createdAt: user.createdAt,
      };
    }
  }

  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    res.status(401).json({ success: false, message: 'Username/email atau password salah' });
    return;
  }

  const email = account.email ?? account.username ?? '';
  const token = jwt.sign(
    {
      id: account.id,
      username: account.username ?? account.email,
      email,
      nama: account.nama,
      role: account.role,
      accountType: account.accountType,
    },
    getJwtSecret(),
    { expiresIn: '24h' },
  );

  res.json({
    success: true,
    message: 'Login berhasil',
    data: {
      token,
      id: account.id,
      nama: account.nama,
      username: account.username ?? account.email,
      email,
      role: account.role,
      avatarUrl: account.avatarUrl || null,
      jabatan: account.jabatan || null,
      phone: account.phone || null,
      authProvider: account.authProvider || 'local',
      createdAt: account.createdAt ?? null,
    },
  });
});

export const getGoogleAuthConfig: RequestHandler = (_req, res) => {
  const clientId = getPublicGoogleClientId();
  res.json({
    success: true,
    data: {
      enabled: Boolean(clientId),
      clientId,
    },
  });
};

export const googleLogin = asyncHandler(async (req, res) => {
  const body = getBody(req);
  const idToken = isNonEmptyString(body.idToken)
    ? body.idToken.trim()
    : (isNonEmptyString(body.id_token) ? body.id_token.trim() : '');
  const accessToken = isNonEmptyString(body.accessToken)
    ? body.accessToken.trim()
    : (isNonEmptyString(body.access_token) ? body.access_token.trim() : '');

  if (!idToken && !accessToken) {
    res.status(400).json({
      success: false,
      message: 'Token autentikasi Google (idToken atau accessToken) wajib disertakan.',
    });
    return;
  }

  let googleProfile;
  try {
    googleProfile = await verifyGoogleCredentials({ idToken, accessToken });
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      res.status(err.statusCode).json({
        success: false,
        message: err.message,
      });
      return;
    }
    throw err;
  }

  const email = googleProfile.email;
  const nama = sanitizeString(googleProfile.nama) || 'Pengunjung Google';
  const googleAvatarUrl = googleProfile.avatarUrl && googleProfile.avatarUrl.length <= 500
    ? googleProfile.avatarUrl
    : null;

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          nama,
          email,
          passwordHash: null,
          authProvider: 'google',
          avatarUrl: googleAvatarUrl,
          role: 'USER',
        },
      });
    } catch (error) {
      // Tangani kondisi race condition jika akun baru saja dibuat secara bersamaan
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        user = await prisma.user.findUnique({ where: { email } });
      } else {
        throw error;
      }
    }
  } else {
    // Akun sudah terdaftar: perbarui avatar hanya jika belum punya foto profil (agar foto Vercel Blob custom tidak tertimpa)
    const updateData: { nama?: string; avatarUrl?: string | null; authProvider?: string } = {};
    if (!user.avatarUrl && googleAvatarUrl) {
      updateData.avatarUrl = googleAvatarUrl;
    }
    if (!user.nama || !user.nama.trim()) {
      updateData.nama = nama;
    }
    if (!user.passwordHash && user.authProvider !== 'google') {
      updateData.authProvider = 'google';
    }
    if (Object.keys(updateData).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    }
  }

  if (!user) {
    res.status(500).json({
      success: false,
      message: 'Gagal memproses akun Google di database.',
    });
    return;
  }

  const token = jwt.sign(
    {
      id: user.id,
      username: user.email,
      email: user.email,
      nama: user.nama,
      role: user.role,
      accountType: 'USER',
    },
    getJwtSecret(),
    { expiresIn: '24h' },
  );

  const userPayload = {
    id: user.id,
    nama: user.nama,
    username: user.email,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl || null,
    authProvider: user.authProvider || 'google',
    createdAt: user.createdAt,
  };

  res.json({
    success: true,
    message: 'Login dengan Google berhasil',
    data: {
      token,
      ...userPayload,
      user: userPayload,
    },
  });
});

const RESET_OTP_EXPIRES_MINUTES = 15;

interface ResetJwtPayload {
  email?: string;
  id?: number;
  resetId?: number;
  accountType?: 'ADMIN' | 'USER';
  purpose?: string;
}

async function findResetAccountsByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const [adminByEmail, adminAlias, user] = await Promise.all([
    prisma.admin.findUnique({ where: { username: normalized } }),
    normalized === 'admin@museum.com'
      ? prisma.admin.findUnique({ where: { username: 'admin' } })
      : Promise.resolve(null),
    prisma.user.findUnique({ where: { email: normalized } }),
  ]);

  return {
    admin: adminByEmail ?? adminAlias,
    user,
  };
}

function resolveResetBaseUrl(req: Request, isAdminClient: boolean): string {
  if (isAdminClient) {
    const envAdminUrl = process.env.ADMIN_FRONTEND_URL?.trim();
    if (envAdminUrl) {
      return envAdminUrl.replace(/\/$/, '');
    }
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (/^https?:\/\/[^/\s]+$/i.test(originHeader)) {
      return originHeader.replace(/\/$/, '');
    }
    return 'http://localhost:3000';
  }

  return (process.env.FRONTEND_URL || 'http://localhost:64855').replace(/\/$/, '');
}

export const forgotPassword = asyncHandler(async (req, res) => {
  const body = getBody(req);
  const email = isValidEmail(body.email) ? (body.email as string).trim().toLowerCase() : '';
  if (!email) {
    res.status(400).json({ success: false, message: 'Alamat email valid wajib diisi' });
    return;
  }

  const { admin, user } = await findResetAccountsByEmail(email);
  if (!admin && !user) {
    res.status(404).json({
      success: false,
      message: 'Alamat email tidak terdaftar di database Museum Brawijaya',
    });
    return;
  }

  const clientParam = typeof body.client === 'string' ? body.client.trim().toLowerCase() : '';
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  const isAdminClient =
    clientParam === 'admin'
    || originHeader.includes(':3000')
    || (Boolean(admin) && !user);

  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const expiredAt = new Date(Date.now() + RESET_OTP_EXPIRES_MINUTES * 60 * 1000);

  // Nonaktifkan OTP lama yang belum dipakai lalu simpan OTP baru di tabel password_resets
  const resetRecord = await prisma.$transaction(async (tx) => {
    await tx.passwordReset.updateMany({
      where: { email, used: 0 },
      data: { used: 1 },
    });

    return tx.passwordReset.create({
      data: {
        email,
        otpCode,
        used: 0,
        expiredAt,
      },
    });
  });

  const resetToken = jwt.sign(
    {
      email,
      id: admin ? admin.id : user!.id,
      resetId: resetRecord.id,
      accountType: admin ? 'ADMIN' : 'USER',
      purpose: 'reset-password',
    },
    getJwtSecret(),
    { expiresIn: `${RESET_OTP_EXPIRES_MINUTES}m` },
  );

  const baseUrl = resolveResetBaseUrl(req, isAdminClient);
  const resetLink = isAdminClient
    ? `${baseUrl}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(resetToken)}`
    : `${baseUrl}/#/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(resetToken)}`;

  // Jika SMTP nyata aktif dan ADMIN_RECOVERY_EMAIL diatur di .env untuk admin@museum.com, kirim ke email pemulihan tersebut
  const hasRealSmtp = Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
  const recoveryEmail = process.env.ADMIN_RECOVERY_EMAIL?.trim().toLowerCase();
  const deliveryTarget =
    hasRealSmtp && email === 'admin@museum.com' && recoveryEmail && isValidEmail(recoveryEmail)
      ? recoveryEmail
      : email;

  const emailResult = await sendPasswordResetEmail({
    to: deliveryTarget,
    accountEmail: email,
    nama: admin?.nama || user?.nama || 'Pengguna',
    resetToken,
    resetLink,
    otpCode,
    accountLabel: isAdminClient
      ? 'Layanan Keamanan Panel Admin Museum Brawijaya'
      : 'Layanan Keamanan Akun Pengunjung',
    expiresInMinutes: RESET_OTP_EXPIRES_MINUTES,
  });

  if (!emailResult.success) {
    res.status(503).json({
      success: false,
      message: 'Gagal mengirim email verifikasi OTP. Periksa koneksi internet atau pengaturan SMTP server.',
    });
    return;
  }

  const responseData: Record<string, unknown> = {
    email,
    sentTo: deliveryTarget,
    expiresInMinutes: RESET_OTP_EXPIRES_MINUTES,
    deliveryMode: emailResult.deliveryMode || 'smtp',
    previewUrl: emailResult.previewUrl || null,
    emailSent: emailResult.success,
  };

  // Pertahankan kompatibilitas respons untuk aplikasi pengunjung (User_Mobile)
  if (!isAdminClient) {
    responseData.resetToken = resetToken;
    responseData.resetLink = resetLink;
  }

  res.json({
    success: true,
    message:
      emailResult.deliveryMode === 'ethereal'
        ? 'Kode OTP dan tautan verifikasi berhasil dikirim ke kotak masuk preview Ethereal.'
        : 'Kode OTP dan tautan verifikasi reset kata sandi telah berhasil dikirim ke email Anda.',
    data: responseData,
  });
});

export const verifyResetOtp = asyncHandler(async (req, res) => {
  const body = getBody(req);
  const email = isValidEmail(body.email) ? (body.email as string).trim().toLowerCase() : '';
  const rawOtp = isNonEmptyString(body.otp)
    ? body.otp
    : (isNonEmptyString(body.otpCode) ? body.otpCode : '');
  const otp = rawOtp.trim();

  if (!email) {
    res.status(400).json({ success: false, message: 'Alamat email valid wajib diisi' });
    return;
  }

  if (!/^\d{6}$/.test(otp)) {
    res.status(400).json({ success: false, message: 'Kode OTP harus terdiri dari 6 digit angka' });
    return;
  }

  const activeRecord = await prisma.passwordReset.findFirst({
    where: {
      email,
      otpCode: otp,
      used: 0,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!activeRecord) {
    res.status(400).json({
      success: false,
      message: 'Kode OTP tidak valid atau sudah digunakan. Periksa kembali kode di email Anda.',
    });
    return;
  }

  if (activeRecord.expiredAt.getTime() <= Date.now()) {
    await prisma.passwordReset.update({
      where: { id: activeRecord.id },
      data: { used: 1 },
    });
    res.status(400).json({
      success: false,
      message: 'Kode OTP sudah kedaluwarsa. Silakan kirim ulang kode OTP baru.',
    });
    return;
  }

  const verifiedToken = jwt.sign(
    {
      email,
      resetId: activeRecord.id,
      purpose: 'reset-password-verified',
    },
    getJwtSecret(),
    { expiresIn: '10m' },
  );

  res.json({
    success: true,
    message: 'Kode OTP berhasil diverifikasi. Silakan buat kata sandi baru.',
    data: {
      email,
      verified: true,
      resetToken: verifiedToken,
    },
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const body = getBody(req);
  const providedEmail = isValidEmail(body.email) ? (body.email as string).trim().toLowerCase() : '';
  const token = isNonEmptyString(body.token) ? (body.token as string).trim() : '';
  const rawOtp = isNonEmptyString(body.otp)
    ? body.otp
    : (isNonEmptyString(body.otpCode) ? body.otpCode : '');
  const otp = rawOtp.trim();
  const newPassword = body.newPassword || body.password;

  if (!isNonEmptyString(newPassword)) {
    res.status(400).json({ success: false, message: 'Kata sandi baru wajib diisi' });
    return;
  }

  const passwordCheck = validatePasswordStrength(newPassword);
  if (!passwordCheck.valid || typeof newPassword !== 'string') {
    res.status(400).json({ success: false, message: passwordCheck.message });
    return;
  }

  let verifiedEmail = '';

  // Metode 1: Verifikasi menggunakan Kode OTP 6 digit dari tabel password_resets
  if (otp) {
    if (!providedEmail) {
      res.status(400).json({ success: false, message: 'Alamat email wajib diisi bersama kode OTP' });
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      res.status(400).json({ success: false, message: 'Kode OTP harus terdiri dari 6 digit angka' });
      return;
    }

    const otpRecord = await prisma.passwordReset.findFirst({
      where: {
        email: providedEmail,
        otpCode: otp,
        used: 0,
        expiredAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      res.status(400).json({
        success: false,
        message: 'Kode OTP tidak valid atau sudah kedaluwarsa. Silakan minta kode baru.',
      });
      return;
    }

    verifiedEmail = providedEmail;
  } else if (token) {
    // Metode 2: Verifikasi menggunakan signed JWT token dari tautan email / hasil verifyResetOtp
    let decoded: ResetJwtPayload;
    try {
      decoded = jwt.verify(token, getJwtSecret()) as ResetJwtPayload;
    } catch {
      res.status(400).json({
        success: false,
        message: 'Tautan verifikasi reset kata sandi tidak valid atau sudah kedaluwarsa.',
      });
      return;
    }

    const tokenEmail = isValidEmail(decoded?.email) ? decoded.email!.trim().toLowerCase() : '';
    const validPurpose =
      decoded?.purpose === 'reset-password' || decoded?.purpose === 'reset-password-verified';

    if (!tokenEmail || !validPurpose) {
      res.status(400).json({
        success: false,
        message: 'Token verifikasi reset kata sandi tidak valid.',
      });
      return;
    }

    if (providedEmail && providedEmail !== tokenEmail) {
      res.status(400).json({
        success: false,
        message: 'Alamat email tidak sesuai dengan tautan verifikasi.',
      });
      return;
    }

    const activeRecord = await prisma.passwordReset.findFirst({
      where: {
        ...(typeof decoded.resetId === 'number' ? { id: decoded.resetId } : {}),
        email: tokenEmail,
        used: 0,
        expiredAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeRecord) {
      res.status(400).json({
        success: false,
        message: 'Tautan reset kata sandi sudah digunakan atau kedaluwarsa. Silakan minta tautan baru.',
      });
      return;
    }

    verifiedEmail = tokenEmail;
  } else {
    res.status(400).json({
      success: false,
      message: 'Kode OTP atau tautan verifikasi email wajib disertakan untuk mengubah kata sandi.',
    });
    return;
  }

  const { admin, user } = await findResetAccountsByEmail(verifiedEmail);
  if (!admin && !user) {
    res.status(404).json({
      success: false,
      message: 'Akun dengan email tersebut tidak ditemukan di database',
    });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await prisma.$transaction(async (tx) => {
    if (admin) {
      await tx.admin.update({
        where: { id: admin.id },
        data: { passwordHash },
      });
    }
    if (user) {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
    }
    await tx.passwordReset.updateMany({
      where: { email: verifiedEmail, used: 0 },
      data: { used: 1 },
    });
  });

  res.json({
    success: true,
    message: 'Kata sandi berhasil diperbarui di database. Silakan masuk kembali dengan kata sandi baru Anda.',
  });
});

export const logout: RequestHandler = (_req, res) => {
  res.json({ success: true, message: 'Logout berhasil' });
};

export const getMe = asyncHandler(async (req, res) => {
  const identity = req.user;
  if (!identity) {
    res.status(401).json({ success: false, message: 'Tidak terotentikasi' });
    return;
  }

  const accountType = identity.accountType
    ?? (identity.role.toUpperCase() === 'USER' ? 'USER' : 'ADMIN');
  if (accountType === 'ADMIN') {
    const username = identity.username ?? identity.email;
    const admin =
      (await prisma.admin.findUnique({ where: { id: identity.id } })) ??
      (username ? await prisma.admin.findUnique({ where: { username } }) : null);

    if (!admin) {
      res.status(401).json({ success: false, message: 'Akun tidak lagi tersedia' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: admin.id,
        nama: admin.nama,
        username: admin.username,
        email: admin.username,
        role: admin.role,
        avatarUrl: admin.avatarUrl || null,
        jabatan: admin.jabatan || null,
        phone: admin.phone || null,
        createdAt: admin.createdAt,
      },
    });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: identity.id } });
  if (!user) {
    res.status(401).json({ success: false, message: 'Akun tidak lagi tersedia' });
    return;
  }

  res.json({
    success: true,
    data: {
      id: user.id,
      nama: user.nama,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
      authProvider: user.authProvider,
      createdAt: user.createdAt,
    },
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const identity = req.user;
  const body = getBody(req);

  if (!identity || !identity.id) {
    res.status(401).json({ success: false, message: 'Autentikasi diperlukan. Silakan login kembali.' });
    return;
  }

  const isAdminAccount =
    identity.accountType === 'ADMIN' ||
    (identity.accountType !== 'USER' && identity.role.toUpperCase() !== 'USER');

  if (isAdminAccount) {
    const adminUsername = identity.username ?? identity.email;
    const admin =
      (await prisma.admin.findUnique({ where: { id: identity.id } })) ??
      (adminUsername ? await prisma.admin.findUnique({ where: { username: adminUsername } }) : null);

    if (!admin) {
      res.status(404).json({ success: false, message: 'Akun admin tidak ditemukan' });
      return;
    }

    const adminUpdateData: {
      nama?: string;
      username?: string;
      jabatan?: string | null;
      phone?: string | null;
      avatarUrl?: string | null;
    } = {};

    if (body.nama !== undefined) {
      const cleanedNama = sanitizeString(body.nama);
      if (cleanedNama.length < 2) {
        res.status(400).json({ success: false, message: 'Nama lengkap minimal 2 karakter' });
        return;
      }
      adminUpdateData.nama = cleanedNama;
    }

    if (body.email !== undefined) {
      if (!isValidEmail(body.email)) {
        res.status(400).json({ success: false, message: 'Format alamat email tidak valid' });
        return;
      }
      const newEmail = (body.email as string).trim().toLowerCase();
      if (newEmail !== admin.username) {
        const existingAdmin = await prisma.admin.findUnique({ where: { username: newEmail } });
        if (existingAdmin && existingAdmin.id !== admin.id) {
          res.status(409).json({ success: false, message: 'Alamat email sudah digunakan oleh admin lain' });
          return;
        }
        adminUpdateData.username = newEmail;
      }
    }

    if (body.jabatan !== undefined) {
      const cleanedJabatan = sanitizeString(body.jabatan);
      adminUpdateData.jabatan = cleanedJabatan ? cleanedJabatan.slice(0, 120) : null;
    }

    if (body.phone !== undefined) {
      const cleanedPhone = typeof body.phone === 'string' ? body.phone.replace(/[^\d+\s-]/g, '').trim() : '';
      adminUpdateData.phone = cleanedPhone ? cleanedPhone.slice(0, 40) : null;
    }

    let shouldDeleteOldAdminBlob = false;
    if (body.avatarUrl === null || body.avatarUrl === '') {
      adminUpdateData.avatarUrl = null;
      shouldDeleteOldAdminBlob = Boolean(admin.avatarUrl);
    } else if (typeof body.avatarUrl === 'string') {
      const trimmedUrl = body.avatarUrl.trim();
      if (trimmedUrl.length > 500) {
        res.status(400).json({ success: false, message: 'URL foto profil terlalu panjang' });
        return;
      }
      adminUpdateData.avatarUrl = trimmedUrl || null;
    }

    const updatedAdmin =
      Object.keys(adminUpdateData).length > 0
        ? await prisma.admin.update({
            where: { id: admin.id },
            data: adminUpdateData,
          })
        : admin;

    if (shouldDeleteOldAdminBlob && admin.avatarUrl) {
      void deleteFileByUrl(admin.avatarUrl);
    }

    const refreshedAdminToken = jwt.sign(
      {
        id: updatedAdmin.id,
        username: updatedAdmin.username,
        email: updatedAdmin.username,
        nama: updatedAdmin.nama,
        role: updatedAdmin.role,
        accountType: 'ADMIN',
      },
      getJwtSecret(),
      { expiresIn: '24h' },
    );

    res.json({
      success: true,
      message: 'Profil admin berhasil diperbarui di database',
      data: {
        token: refreshedAdminToken,
        user: {
          id: updatedAdmin.id,
          nama: updatedAdmin.nama,
          username: updatedAdmin.username,
          email: updatedAdmin.username,
          role: updatedAdmin.role,
          avatarUrl: updatedAdmin.avatarUrl || null,
          jabatan: updatedAdmin.jabatan || null,
          phone: updatedAdmin.phone || null,
          createdAt: updatedAdmin.createdAt,
        },
      },
    });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: identity.id } });
  if (!user) {
    res.status(404).json({ success: false, message: 'Akun pengguna tidak ditemukan' });
    return;
  }

  const updateData: {
    nama?: string;
    email?: string;
    passwordHash?: string;
    avatarUrl?: string | null;
  } = {};

  if (body.nama !== undefined) {
    const cleanedNama = sanitizeString(body.nama);
    if (cleanedNama.length < 2) {
      res.status(400).json({ success: false, message: 'Nama lengkap minimal 2 karakter' });
      return;
    }
    updateData.nama = cleanedNama;
  }

  if (body.email !== undefined) {
    if (!isValidEmail(body.email)) {
      res.status(400).json({ success: false, message: 'Format alamat email tidak valid' });
      return;
    }
    const newEmail = (body.email as string).trim().toLowerCase();
    if (newEmail !== user.email) {
      const [existingUser, existingAdmin] = await Promise.all([
        prisma.user.findUnique({ where: { email: newEmail } }),
        prisma.admin.findUnique({ where: { username: newEmail } }),
      ]);
      if ((existingUser && existingUser.id !== user.id) || existingAdmin) {
        res.status(409).json({ success: false, message: 'Alamat email sudah digunakan oleh pengguna lain' });
        return;
      }
      updateData.email = newEmail;
    }
  }

  let shouldDeleteOldBlob = false;
  if (body.avatarUrl === null || body.avatarUrl === '') {
    updateData.avatarUrl = null;
    shouldDeleteOldBlob = Boolean(user.avatarUrl);
  } else if (typeof body.avatarUrl === 'string') {
    const trimmedUrl = body.avatarUrl.trim();
    if (trimmedUrl.length > 500) {
      res.status(400).json({ success: false, message: 'URL foto profil terlalu panjang' });
      return;
    }
    updateData.avatarUrl = trimmedUrl || null;
  }

  if (body.newPassword !== undefined && body.newPassword !== null && body.newPassword !== '') {
    if (typeof body.newPassword !== 'string') {
      res.status(400).json({ success: false, message: 'Format kata sandi baru tidak valid' });
      return;
    }

    const newPass = body.newPassword;
    const strength = validatePasswordStrength(newPass);
    if (!strength.valid) {
      res.status(400).json({ success: false, message: strength.message });
      return;
    }

    if (user.passwordHash) {
      if (!isNonEmptyString(body.currentPassword)) {
        res.status(400).json({ success: false, message: 'Kata sandi saat ini wajib diisi' });
        return;
      }
      const match = await bcrypt.compare(body.currentPassword as string, user.passwordHash);
      if (!match) {
        res.status(400).json({ success: false, message: 'Kata sandi saat ini tidak cocok' });
        return;
      }
      if (body.currentPassword === newPass) {
        res.status(400).json({ success: false, message: 'Kata sandi baru harus berbeda dari kata sandi saat ini' });
        return;
      }
    }

    updateData.passwordHash = await bcrypt.hash(newPass, 10);
  }

  const updated = Object.keys(updateData).length > 0
    ? await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      })
    : user;

  if (shouldDeleteOldBlob && user.avatarUrl) {
    void deleteFileByUrl(user.avatarUrl);
  }

  const refreshedToken = jwt.sign(
    {
      id: updated.id,
      username: updated.email,
      email: updated.email,
      nama: updated.nama,
      role: updated.role,
      accountType: 'USER',
    },
    getJwtSecret(),
    { expiresIn: '24h' },
  );

  res.json({
    success: true,
    message: 'Profil berhasil diperbarui di database',
    data: {
      token: refreshedToken,
      user: {
        id: updated.id,
        nama: updated.nama,
        email: updated.email,
        role: updated.role,
        avatarUrl: updated.avatarUrl,
        authProvider: updated.authProvider,
        createdAt: updated.createdAt,
      },
    },
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const identity = req.user;
  const body = getBody(req);

  if (!identity || !identity.id) {
    res.status(401).json({ success: false, message: 'Autentikasi diperlukan. Silakan login kembali.' });
    return;
  }

  const isAdminAccount =
    identity.accountType === 'ADMIN' ||
    (identity.accountType !== 'USER' && identity.role.toUpperCase() !== 'USER');

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : undefined;

  if (!newPassword) {
    res.status(400).json({ success: false, message: 'Kata sandi baru wajib diisi' });
    return;
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    res.status(400).json({ success: false, message: 'Konfirmasi kata sandi baru tidak cocok' });
    return;
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    res.status(400).json({ success: false, message: strength.message });
    return;
  }

  if (isAdminAccount) {
    const adminUsername = identity.username ?? identity.email;
    const admin =
      (await prisma.admin.findUnique({ where: { id: identity.id } })) ??
      (adminUsername ? await prisma.admin.findUnique({ where: { username: adminUsername } }) : null);
    if (!admin) {
      res.status(404).json({ success: false, message: 'Akun admin tidak ditemukan' });
      return;
    }

    if (!currentPassword) {
      res.status(400).json({ success: false, message: 'Kata sandi saat ini wajib diisi' });
      return;
    }

    const match = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!match) {
      res.status(400).json({ success: false, message: 'Kata sandi saat ini tidak cocok' });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({ success: false, message: 'Kata sandi baru harus berbeda dari kata sandi saat ini' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id: admin.id },
        data: { passwordHash },
      });
      await tx.user.updateMany({
        where: { email: admin.username },
        data: { passwordHash },
      });
    });

    res.json({
      success: true,
      message: 'Kata sandi admin berhasil diperbarui di database',
    });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: identity.id } });
  if (!user) {
    res.status(404).json({ success: false, message: 'Akun pengguna tidak ditemukan' });
    return;
  }

  if (user.passwordHash) {
    if (!currentPassword) {
      res.status(400).json({ success: false, message: 'Kata sandi saat ini wajib diisi' });
      return;
    }

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      res.status(400).json({ success: false, message: 'Kata sandi saat ini tidak cocok' });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({ success: false, message: 'Kata sandi baru harus berbeda dari kata sandi saat ini' });
      return;
    }
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  res.json({
    success: true,
    message: 'Kata sandi berhasil diperbarui di database',
  });
});
