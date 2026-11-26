import { query } from '../database';

const PENGUMUMAN_FIELDS = 'id, title, description, category, date, status';
const FAQ_FIELDS = 'id, question, answer';
const JAM_OPERASIONAL_FIELDS = 'id, hari, jam, telepon, updated_at';

export const informasiModel = {
  async getAllPengumuman(status?: string) {
    if (status && status !== 'Semua') {
      return query(
        `SELECT ${PENGUMUMAN_FIELDS} FROM pengumuman WHERE status = ? ORDER BY id DESC`,
        [status],
      );
    }
    return query(`SELECT ${PENGUMUMAN_FIELDS} FROM pengumuman ORDER BY id DESC`);
  },

  async findPengumumanById(id: string | number) {
    const [item] = await query(
      `SELECT ${PENGUMUMAN_FIELDS} FROM pengumuman WHERE id = ?`,
      [id],
    );
    return item;
  },

  async createPengumuman(payload: {
    title: string;
    description?: string;
    category: string;
    date: string;
    status?: string;
  }) {
    const result = await query(
      `INSERT INTO pengumuman (title, description, category, date, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        payload.title,
        payload.description || '',
        payload.category,
        payload.date,
        payload.status || 'AKTIF',
      ],
    );
    return this.findPengumumanById(result.insertId);
  },

  async updatePengumuman(
    id: string | number,
    payload: {
      title: string;
      description: string;
      category: string;
      date: string;
      status: string;
    },
  ) {
    await query(
      `UPDATE pengumuman
       SET title = ?, description = ?, category = ?, date = ?, status = ?
       WHERE id = ?`,
      [
        payload.title,
        payload.description,
        payload.category,
        payload.date,
        payload.status,
        id,
      ],
    );
    return this.findPengumumanById(id);
  },

  async deletePengumuman(id: string | number) {
    return query('DELETE FROM pengumuman WHERE id = ?', [id]);
  },

  async getAllFaq() {
    return query(`SELECT ${FAQ_FIELDS} FROM faq ORDER BY id ASC`);
  },

  async findFaqById(id: string | number) {
    const [item] = await query(`SELECT ${FAQ_FIELDS} FROM faq WHERE id = ?`, [id]);
    return item;
  },

  async createFaq(question: string, answer: string) {
    const result = await query(
      'INSERT INTO faq (question, answer) VALUES (?, ?)',
      [question, answer],
    );
    return this.findFaqById(result.insertId);
  },

  async updateFaq(id: string | number, question: string, answer: string) {
    await query(
      'UPDATE faq SET question = ?, answer = ? WHERE id = ?',
      [question, answer, id],
    );
    return this.findFaqById(id);
  },

  async deleteFaq(id: string | number) {
    return query('DELETE FROM faq WHERE id = ?', [id]);
  },

  async getJamOperasional() {
    const [hours] = await query(
      `SELECT ${JAM_OPERASIONAL_FIELDS} FROM jam_operasional ORDER BY id DESC LIMIT 1`,
    );
    return hours;
  },

  async upsertJamOperasional(payload: {
    hari?: string;
    jam?: string;
    telepon?: string;
  }) {
    const existing = await this.getJamOperasional();
    if (existing) {
      await query(
        `UPDATE jam_operasional
         SET hari = ?, jam = ?, telepon = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          payload.hari || existing.hari,
          payload.jam || existing.jam,
          payload.telepon || existing.telepon,
          existing.id,
        ],
      );
    } else {
      await query(
        'INSERT INTO jam_operasional (hari, jam, telepon) VALUES (?, ?, ?)',
        [
          payload.hari || 'Selasa - Minggu (Senin Libur)',
          payload.jam || '08:00 - 15:00 WIB',
          payload.telepon || '',
        ],
      );
    }
    return this.getJamOperasional();
  },
};