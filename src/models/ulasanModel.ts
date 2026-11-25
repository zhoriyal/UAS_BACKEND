import { query } from '../database';

const ULASAN_FIELDS =
  'id, nama, avatar_initial, avatar_color, category, rating, comment, reply, reply_date, created_at, updated_at';

const AVATAR_PALETTE = [
  '#3F5243',
  '#6B4C2A',
  '#7A5C3C',
  '#4A6670',
  '#5E4266',
  '#436B5A',
];

function pickAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % AVATAR_PALETTE.length;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export interface UlasanFilter {
  search?: string;
  rating?: string;
  status?: string;
  page: number;
  limit: number;
}

export interface CreateUlasanInput {
  nama: string;
  avatar_initial?: string;
  avatar_color?: string;
  category?: string;
  rating: number;
  comment: string;
}

export const ulasanModel = {
  async findPaginated({ search, rating, status, page, limit }: UlasanFilter) {
    let where = ' FROM ulasan WHERE 1=1';
    const params: unknown[] = [];

    if (search) {
      where += ' AND (nama LIKE ? OR comment LIKE ? OR category LIKE ?)';
      const value = `%${search}%`;
      params.push(value, value, value);
    }
    if (rating && rating !== 'Semua Rating') {
      const parsedRating = Number(rating);
      if (Number.isInteger(parsedRating) && parsedRating >= 1 && parsedRating <= 5) {
        where += ' AND rating = ?';
        params.push(parsedRating);
      }
    }
    if (status === 'Sudah Dibalas') {
      where += " AND reply IS NOT NULL AND reply != ''";
    } else if (status === 'Belum Dibalas') {
      where += " AND (reply IS NULL OR reply = '')";
    }

    const safePage = Math.max(1, Math.trunc(Number(page) || 1));
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 10)));
    const safeOffset = (safePage - 1) * safeLimit;

    const [{ total }] = await query(`SELECT COUNT(*) AS total${where}`, params);
    const items = await query(
      `SELECT ${ULASAN_FIELDS}${where} ORDER BY created_at DESC, id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [stats] = await query('SELECT AVG(rating) AS average, COUNT(*) AS total FROM ulasan');

    return {
      total: Number(total ?? 0),
      items: items || [],
      averageRating: Math.round(Number(stats?.average ?? 0) * 10) / 10,
      overallTotal: Number(stats?.total ?? 0),
    };
  },

  async findById(id: string | number) {
    const [item] = await query(
      `SELECT ${ULASAN_FIELDS} FROM ulasan WHERE id = ?`,
      [id],
    );
    return item;
  },

  async create(payload: CreateUlasanInput) {
    const trimmedName = payload.nama.trim() || 'Pengunjung';
    const initial =
      (payload.avatar_initial?.trim().charAt(0) || trimmedName.charAt(0) || 'P').toUpperCase();
    const avatarColor = payload.avatar_color?.trim() || pickAvatarColor(trimmedName);
    const category = payload.category?.trim() || 'Kunjungan Umum';

    const result = await query(
      `INSERT INTO ulasan
        (nama, avatar_initial, avatar_color, category, rating, comment, reply, reply_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', '', NOW(), NOW())`,
      [
        trimmedName,
        initial,
        avatarColor,
        category,
        payload.rating,
        payload.comment.trim(),
      ],
    );
    return this.findById(result.insertId);
  },

  async updateReply(id: string | number, reply: string, replyDate: string) {
    await query(
      'UPDATE ulasan SET reply = ?, reply_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [reply, replyDate, id],
    );
    return this.findById(id);
  },

  async deleteById(id: string | number) {
    return query('DELETE FROM ulasan WHERE id = ?', [id]);
  },
};