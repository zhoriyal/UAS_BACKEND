import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';
import type { Request, RequestHandler, Response } from 'express';
import prisma from '../lib/prisma';
import { getJwtSecret } from '../lib/jwtSecret';
import { isNonEmptyString, isValidEmail, sanitizeString } from '../lib/validate';
import { validatePasswordStrength } from '../lib/validatePassword';

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

    res.status(201).json({
      success: true,
      message: 'Pendaftaran berhasil. Silakan login dengan akun Anda.',
      data: { id: user.id, nama: user.nama, email: user.email, role: user.role },
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
    },
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
    const admin = username
      ? await prisma.admin.findUnique({ where: { username } })
      : null;

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
    },
  });
});
