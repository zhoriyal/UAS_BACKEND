/**
 * Middleware untuk memastikan role user sesuai izin endpoint
 * Contoh penggunaan: requireRole(['ADMIN', 'SUPERADMIN'])
 */
function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Tidak terotentikasi.',
      });
    }

    const userRole = (req.user.role || 'USER').toUpperCase();
    const authorized = allowedRoles.map((r) => r.toUpperCase()).includes(userRole);

    if (!authorized) {
      return res.status(403).json({
        success: false,
        message: `Akses ditolak: Memerlukan hak akses [${allowedRoles.join(', ')}].`,
      });
    }

    next();
  };
}

module.exports = requireRole;

