import type { RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { getJwtSecret } from '../lib/jwtSecret';
import type { AuthUser } from '../types/express';

function toAuthUser(payload: string | JwtPayload): AuthUser | null {
  if (typeof payload === 'string') {
    return null;
  }

  const { id, nama, role, accountType, username, email } = payload;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    typeof nama !== 'string' ||
    typeof role !== 'string' ||
    (accountType !== undefined && accountType !== 'USER' && accountType !== 'ADMIN')
  ) {
    return null;
  }

  return {
    id,
    nama,
    role,
    ...(accountType === 'USER' || accountType === 'ADMIN' ? { accountType } : {}),
    ...(typeof username === 'string' ? { username } : {}),
    ...(typeof email === 'string' ? { email } : {}),
  };
}

const authMiddleware: RequestHandler = (req, res, next) => {
  const authorization = req.get('authorization');
  const [scheme, token, extra] = authorization?.trim().split(/\s+/) ?? [];

  if (scheme !== 'Bearer' || !token || extra) {
    res.status(401).json({
      success: false,
      message: 'Token autentikasi tidak ditemukan atau formatnya tidak valid.',
    });
    return;
  }

  try {
    const user = toAuthUser(jwt.verify(token, getJwtSecret()));
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Token tidak valid. Silakan login kembali.',
      });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('JWT_SECRET')) {
      next(error);
      return;
    }

    res.status(401).json({
      success: false,
      message: 'Sesi kedaluwarsa atau token tidak valid. Silakan login kembali.',
    });
  }
};

export default authMiddleware;
