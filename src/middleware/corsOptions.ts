import type { CorsOptions } from 'cors';

function parseAllowedOrigins(configuredOrigins: string): Set<string> {
  const origins = new Set<string>();

  for (const value of configuredOrigins.split(',')) {
    const origin = value.trim();
    if (!origin) continue;

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS harus berisi daftar origin yang valid');
    }

    if (
      origin.includes('*')
      || !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      throw new Error('CORS_ORIGINS harus berisi origin tanpa wildcard atau path');
    }

    origins.add(parsed.origin);
  }

  return origins;
}

function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (!['http:', 'https:'].includes(protocol)) return false;

    const normalizedHostname = hostname.toLowerCase();
    return normalizedHostname === 'localhost'
      || normalizedHostname === '127.0.0.1'
      || normalizedHostname === '[::1]'
      || normalizedHostname.endsWith('.local');
  } catch {
    return false;
  }
}

export function createCorsOptions(
  nodeEnv = process.env.NODE_ENV,
  configuredOrigins = process.env.CORS_ORIGINS,
): CorsOptions {
  if (nodeEnv === 'production' && !configuredOrigins?.trim()) {
    throw new Error('CORS_ORIGINS wajib diatur di production ke origin frontend yang diizinkan');
  }

  const origins = parseAllowedOrigins(
    configuredOrigins?.trim() || 'http://localhost:3000,http://127.0.0.1:3000',
  );
  if (nodeEnv === 'production' && [...origins].some((origin) => (
    !origin.startsWith('https://') || isLocalDevelopmentOrigin(origin)
  ))) {
    throw new Error('CORS_ORIGINS di production hanya boleh berisi origin HTTPS publik');
  }

  return {
    origin: (origin, callback) => {
      const isAllowedLocalOrigin = nodeEnv !== 'production'
        && origin !== undefined
        && origin !== ''
        && isLocalDevelopmentOrigin(origin);
      if (!origin || origins.has(origin) || isAllowedLocalOrigin) {
        callback(null, true);
        return;
      }

      const error = Object.assign(new Error('Origin CORS tidak diizinkan'), { statusCode: 403 });
      callback(error);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  };
}
