import { query, ensureNotificationsTable } from '../database';

export type NotificationType = 'BOOKING' | 'ULASAN';

const FIELDS = 'id, type, title, message, link, reference_id, is_read, created_at';

let tableReady = false;
async function ensureReady() {
  if (tableReady) return;
  await ensureNotificationsTable();
  tableReady = true;
}

export interface CreateNotificationPayload {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  referenceId?: string | number;
}

export const notifikasiModel = {
  async create(payload: CreateNotificationPayload) {
    await ensureReady();
    await query(
      'INSERT INTO notifications (type, title, message, link, reference_id, is_read) VALUES (?, ?, ?, ?, ?, 0)',
      [
        payload.type,
        payload.title,
        payload.message,
        payload.link ?? null,
        payload.referenceId != null ? String(payload.referenceId) : null,
      ],
    );
  },

  /** Membuat notifikasi tanpa pernah menggagalkan request utama. */
  async safeCreate(payload: CreateNotificationPayload) {
    try {
      await notifikasiModel.create(payload);
    } catch (err) {
      console.warn('[Notifikasi] Gagal menyimpan notifikasi:', err);
    }
  },

  async list(limit = 30) {
    await ensureReady();
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 30)));
    const items = await query<any[]>(
      `SELECT ${FIELDS} FROM notifications ORDER BY id DESC LIMIT ${safeLimit}`,
    );
    const [row] = await query<any[]>('SELECT COUNT(*) AS total FROM notifications WHERE is_read = 0');
    return {
      items: (items || []).map((item) => ({ ...item, is_read: Number(item.is_read) === 1 })),
      unread: Number(row?.total ?? 0),
    };
  },

  async markRead(id: string | number) {
    await ensureReady();
    await query('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
  },

  async markAllRead() {
    await ensureReady();
    await query('UPDATE notifications SET is_read = 1 WHERE is_read = 0');
  },

  async remove(id: string | number) {
    await ensureReady();
    await query('DELETE FROM notifications WHERE id = ?', [id]);
  },
};

