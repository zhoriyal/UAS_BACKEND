import type { ErrorRequestHandler } from 'express';
import { logger } from '../logger';

const clientMessages: Record<number, string> = {
  400: 'Permintaan tidak valid.',
  401: 'Autentikasi diperlukan.',
  403: 'Akses tidak diizinkan.',
  404: 'Data tidak ditemukan.',
  409: 'Permintaan bertentangan dengan status saat ini.',
  413: 'Ukuran permintaan terlalu besar.',
  415: 'Jenis konten tidak didukung.',
  429: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
};

function getStatusCode(error: unknown): number {
  if (typeof error !== 'object' || error === null) return 500;

  const candidate = 'statusCode' in error
    ? error.statusCode
    : 'status' in error
      ? error.status
      : undefined;
  return typeof candidate === 'number' && candidate >= 400 && candidate <= 599
    ? candidate
    : 500;
}

const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const statusCode = getStatusCode(error);
  const context = { err: error, requestId: req.id };
  if (statusCode >= 500) {
    logger.error(context, 'Request failed');
  } else {
    logger.warn(context, 'Request rejected');
  }

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500
      ? 'Terjadi kesalahan server.'
      : clientMessages[statusCode] || 'Permintaan tidak dapat diproses.',
    requestId: req.id,
  });
};

export default errorHandler;
