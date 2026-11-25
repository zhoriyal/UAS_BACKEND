import { query } from '../database';

const KOLEKSI_FIELDS =
  'id, kode, nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url, created_at, updated_at';

export interface KoleksiFilter {
  search?: string;
  kategori?: string;
  status?: string;
  page: number;
  limit: number;
}

export interface KoleksiInput {
  nama?: string;
  sub_deskripsi?: string;
  deskripsi_lengkap?: string;
  kategori?: string;
  tahun?: string;
  lokasi?: string;
  status?: string;
  image_url?: string | null;
}

export const koleksiModel = {
  async findPaginated({ search, kategori, status, page, limit }: KoleksiFilter) {
    let where = ' FROM koleksi WHERE 1=1';
    const params: unknown[] = [];

    if (search) {
      where += ' AND (nama LIKE ? OR kode LIKE ? OR sub_deskripsi LIKE ? OR lokasi LIKE ?)';
      const value = `%${search}%`;
      params.push(value, value, value, value);
    }
    if (kategori && kategori !== 'Semua Kategori' && kategori !== 'Semua') {
      where += ' AND kategori = ?';
      params.push(kategori);
    }
    if (status && status !== 'Semua Status' && status !== 'Semua') {
      where += ' AND status = ?';
      params.push(status);
    }

    const safePage = Math.max(1, Math.trunc(Number(page) || 1));
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 10)));
    const safeOffset = (safePage - 1) * safeLimit;

    const [{ total }] = await query(`SELECT COUNT(*) AS total${where}`, params);
    const items = await query(
      `SELECT ${KOLEKSI_FIELDS}${where} ORDER BY nama ASC, id ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );

    return {
      total: Number(total ?? 0),
      items: items || [],
    };
  },

  async getStats() {
    const [stats] = await query(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(status = 'DIPAMERKAN'), 0) AS dipamerkan,
        COALESCE(SUM(status = 'RESTORASI'), 0) AS restorasi,
        COALESCE(SUM(status = 'SIMPAN'), 0) AS disimpan
      FROM koleksi
    `);

    return {
      total: Number(stats?.total ?? 0),
      dipamerkan: Number(stats?.dipamerkan ?? 0),
      restorasi: Number(stats?.restorasi ?? 0),
      disimpan: Number(stats?.disimpan ?? 0),
    };
  },

  async findById(id: string | number) {
    const [item] = await query(
      `SELECT ${KOLEKSI_FIELDS} FROM koleksi WHERE id = ?`,
      [id],
    );
    return item;
  },

  async generateNextKode(): Promise<string> {
    const [last] = await query('SELECT kode FROM koleksi ORDER BY id DESC LIMIT 1');
    const match = typeof last?.kode === 'string' ? last.kode.match(/(\d+)$/) : null;
    const nextNum = match ? Number.parseInt(match[1], 10) + 1 : 1;
    return `#INV-MB-${String(nextNum).padStart(3, '0')}`;
  },

  async create(payload: KoleksiInput) {
    const kode = await this.generateNextKode();
    const imageUrl =
      typeof payload.image_url === 'string' && payload.image_url.trim()
        ? payload.image_url.trim()
        : null;

    const result = await query(
      `INSERT INTO koleksi
        (kode, nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        kode,
        payload.nama?.trim() || '',
        payload.sub_deskripsi?.trim() || '',
        payload.deskripsi_lengkap?.trim() || '',
        payload.kategori?.trim() || 'Umum',
        payload.tahun?.trim() || '',
        payload.lokasi?.trim() || '',
        payload.status || 'DIPAMERKAN',
        imageUrl,
      ],
    );
    return this.findById(result.insertId);
  },

  async updateById(id: string | number, existing: Record<string, unknown>, payload: KoleksiInput) {
    const nextImageUrl =
      payload.image_url === undefined
        ? existing.image_url
        : typeof payload.image_url === 'string' && payload.image_url.trim()
          ? payload.image_url.trim()
          : null;

    await query(
      `UPDATE koleksi SET
        nama = ?,
        sub_deskripsi = ?,
        deskripsi_lengkap = ?,
        kategori = ?,
        tahun = ?,
        lokasi = ?,
        status = ?,
        image_url = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.nama?.trim() || existing.nama,
        payload.sub_deskripsi ?? existing.sub_deskripsi,
        payload.deskripsi_lengkap ?? existing.deskripsi_lengkap,
        payload.kategori?.trim() || existing.kategori,
        payload.tahun ?? existing.tahun,
        payload.lokasi ?? existing.lokasi,
        payload.status || existing.status,
        nextImageUrl,
        id,
      ],
    );
    return this.findById(id);
  },

  async deleteById(id: string | number) {
    return query('DELETE FROM koleksi WHERE id = ?', [id]);
  },
};