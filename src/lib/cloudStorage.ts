import { del, issueSignedToken, presignUrl, put } from '@vercel/blob';

export const PRIVATE_URL_TTL_SECONDS = 5 * 60;

function getBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN belum dikonfigurasi');
  }
  return token;
}

export interface UploadFileParams {
  pathname: string;
  body: Buffer;
  contentType: string;
  access: 'public' | 'private';
}

export async function uploadFile({ pathname, body, contentType, access }: UploadFileParams) {
  if (!pathname || !Buffer.isBuffer(body) || !contentType) {
    throw new TypeError('pathname, Buffer body, dan contentType wajib diisi');
  }
  if (access !== 'public' && access !== 'private') {
    throw new TypeError('access harus bernilai public atau private');
  }

  return put(pathname, body, {
    access,
    addRandomSuffix: true,
    allowOverwrite: true,
    contentType,
    token: getBlobToken(),
  });
}

export function isVercelBlobUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

export async function deleteFileByUrl(url: string | null | undefined): Promise<void> {
  if (!isVercelBlobUrl(url)) return;
  try {
    await del(url!, { token: getBlobToken() });
  } catch {
    // Abaikan error hapus blob lama agar tidak mengganggu alur utama update profil
  }
}

export async function createSecureDownloadUrl(pathname: string): Promise<string> {
  if (!pathname) {
    throw new TypeError('pathname wajib diisi');
  }

  const validUntil = Date.now() + PRIVATE_URL_TTL_SECONDS * 1000;
  const signedToken = await issueSignedToken({
    token: getBlobToken(),
    pathname,
    operations: ['get'],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: 'get',
    pathname,
    access: 'private',
    validUntil,
    useCache: false,
  });

  return presignedUrl;
}

export default {
  PRIVATE_URL_TTL_SECONDS,
  createSecureDownloadUrl,
  deleteFileByUrl,
  isVercelBlobUrl,
  uploadFile,
};
