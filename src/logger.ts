import { randomUUID } from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'authorization',
      'cookie',
      'password',
      'token',
      'accessToken',
      'refreshToken',
      '*.authorization',
      '*.cookie',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      'req.body.accessToken',
      'req.body.refreshToken',
    ],
    censor: '[REDACTED]',
  },
});

export const requestLogger = pinoHttp({
  logger,
  wrapSerializers: false,
  genReqId: (_req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    return requestId;
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: typeof req.url === 'string' ? req.url.split('?')[0] : undefined,
      remoteAddress: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    }),
  },
});
