import type { RequestHandler } from 'express';

export function requireRole(allowedRoles: readonly string[]): RequestHandler {
  const normalizedRoles = new Set(allowedRoles.map((role) => role.toUpperCase()));

  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Tidak terotentikasi.' });
      return;
    }

    if (!normalizedRoles.has(req.user.role.toUpperCase())) {
      res.status(403).json({
        success: false,
        message: `Akses ditolak: Memerlukan hak akses [${allowedRoles.join(', ')}].`,
      });
      return;
    }

    next();
  };
}

export default requireRole;
