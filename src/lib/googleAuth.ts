import path from 'node:path';
import dotenv from 'dotenv';

export interface VerifiedGoogleProfile {
  sub: string;
  email: string;
  nama: string;
  avatarUrl: string | null;
}

export class GoogleAuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = 'GoogleAuthError';
    this.statusCode = statusCode;
  }
}

const PLACEHOLDER_PATTERNS = [
  'replace-with',
  'your_google_client_id',
  'your-google-client-id',
  'example.apps.googleusercontent.com',
];

function isValidClientIdCandidate(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return false;
  }
  return trimmed.endsWith('.apps.googleusercontent.com');
}

/**
 * Mengambil seluruh Google OAuth Client ID yang valid dari variabel environment backend.
 * Mendukung GOOGLE_CLIENT_ID (utama, biasanya Web Client ID) serta GOOGLE_CLIENT_IDS
 * (daftar dipisahkan koma jika memiliki Android/iOS Client ID terpisah).
 */
export function getConfiguredGoogleClientIds(): string[] {
  const collect = (): string[] => {
    const rawSources = [
      process.env.GOOGLE_CLIENT_ID ?? '',
      process.env.GOOGLE_CLIENT_IDS ?? '',
    ];

    const ids = new Set<string>();
    for (const source of rawSources) {
      for (const part of source.split(',')) {
        const candidate = part.trim();
        if (isValidClientIdCandidate(candidate)) {
          ids.add(candidate);
        }
      }
    }
    return [...ids];
  };

  let ids = collect();
  if (ids.length === 0) {
    // Muat ulang .env jika file baru diubah setelah server berjalan
    dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
    ids = collect();
  }
  return ids;
}

/**
 * Mengembalikan Google Web Client ID publik (bukan secret) untuk dikirim ke client Flutter.
 */
export function getPublicGoogleClientId(): string | null {
  const ids = getConfiguredGoogleClientIds();
  return ids.length > 0 ? ids[0] : null;
}

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = (await response.json().catch(() => null)) as T | null;
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GoogleAuthError('Waktu verifikasi akun Google habis. Silakan coba lagi.', 504);
    }
    throw new GoogleAuthError('Tidak dapat menghubungi server verifikasi Google. Periksa koneksi internet server.', 502);
  } finally {
    clearTimeout(timeoutId);
  }
}

function isEmailVerifiedFlag(val: unknown): boolean {
  return val === true || val === 'true';
}

function fallbackNameFromEmail(email: string): string {
  const prefix = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (!prefix) return 'Pengunjung Google';
  return prefix
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

function matchesAllowedAudience(
  allowedClientIds: string[],
  aud?: string,
  azp?: string,
): boolean {
  if (allowedClientIds.length === 0) return false;
  return Boolean(
    (aud && allowedClientIds.includes(aud)) ||
    (azp && allowedClientIds.includes(azp)),
  );
}

interface GoogleTokenInfoResponse {
  aud?: string;
  azp?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  error_description?: string;
  error?: string;
}

interface GoogleUserInfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  picture?: string;
}

/**
 * Memverifikasi Google ID Token (Android/iOS/OneTap) atau Google OAuth2 Access Token (Flutter Web GIS)
 * melalui endpoint resmi Google dan mengembalikan profil terverifikasi.
 */
export async function verifyGoogleCredentials(params: {
  idToken?: string;
  accessToken?: string;
}): Promise<VerifiedGoogleProfile> {
  const allowedClientIds = getConfiguredGoogleClientIds();
  if (allowedClientIds.length === 0) {
    throw new GoogleAuthError(
      'Login dengan Google belum dikonfigurasi di server. Atur GOOGLE_CLIENT_ID pada file .env UAS_BACKEND.',
      503,
    );
  }

  const idToken = typeof params.idToken === 'string' ? params.idToken.trim() : '';
  const accessToken = typeof params.accessToken === 'string' ? params.accessToken.trim() : '';

  if (!idToken && !accessToken) {
    throw new GoogleAuthError('Token autentikasi Google wajib disertakan.', 400);
  }

  // 1. Verifikasi ID Token (umumnya dari Android / iOS / GIS Credential)
  if (idToken) {
    const tokenInfoRes = await fetchJsonWithTimeout<GoogleTokenInfoResponse>(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );

    if (!tokenInfoRes.ok || !tokenInfoRes.data) {
      throw new GoogleAuthError('Token ID Google tidak valid atau sudah kedaluwarsa.', 401);
    }

    const info = tokenInfoRes.data;
    if (!matchesAllowedAudience(allowedClientIds, info.aud, info.azp)) {
      throw new GoogleAuthError(
        'Google Client ID pada aplikasi tidak cocok dengan GOOGLE_CLIENT_ID di server.',
        401,
      );
    }

    const email = info.email?.trim().toLowerCase() ?? '';
    if (!email || !isEmailVerifiedFlag(info.email_verified)) {
      throw new GoogleAuthError('Email akun Google belum terverifikasi.', 401);
    }

    const nama = info.name?.trim() || fallbackNameFromEmail(email);
    const avatarUrl = info.picture?.trim() || null;

    return {
      sub: info.sub?.trim() || email,
      email,
      nama,
      avatarUrl,
    };
  }

  // 2. Verifikasi OAuth2 Access Token (dari Flutter Web GIS OAuth2 account chooser)
  const tokenInfoRes = await fetchJsonWithTimeout<GoogleTokenInfoResponse>(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );

  if (!tokenInfoRes.ok || !tokenInfoRes.data) {
    throw new GoogleAuthError('Access token Google tidak valid atau sudah kedaluwarsa.', 401);
  }

  const tokenInfo = tokenInfoRes.data;
  if (!matchesAllowedAudience(allowedClientIds, tokenInfo.aud, tokenInfo.azp)) {
    throw new GoogleAuthError(
      'Google Client ID pada aplikasi tidak cocok dengan GOOGLE_CLIENT_ID di server.',
      401,
    );
  }

  // Ambil profil OpenID Connect resmi (tidak memerlukan Google People API)
  const userInfoRes = await fetchJsonWithTimeout<GoogleUserInfoResponse>(
    'https://www.googleapis.com/oauth2/v3/userinfo',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
  );

  if (!userInfoRes.ok || !userInfoRes.data) {
    throw new GoogleAuthError('Gagal mengambil informasi profil dari akun Google.', 401);
  }

  const profile = userInfoRes.data;
  const email = (profile.email || tokenInfo.email || '').trim().toLowerCase();
  const verified = isEmailVerifiedFlag(profile.email_verified) || isEmailVerifiedFlag(tokenInfo.email_verified);

  if (!email || !verified) {
    throw new GoogleAuthError('Email akun Google tidak ditemukan atau belum terverifikasi.', 401);
  }

  const nama = profile.name?.trim() || profile.given_name?.trim() || fallbackNameFromEmail(email);
  const avatarUrl = profile.picture?.trim() || null;

  return {
    sub: profile.sub?.trim() || tokenInfo.sub?.trim() || email,
    email,
    nama,
    avatarUrl,
  };
}
