import path from 'node:path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  buildGroundedContextBlock,
  getMuseumKnowledgeSnapshot,
  type GroundedCollectionItem,
  type MuseumKnowledgeSnapshot,
} from './museumKnowledge';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatImageAttachment {
  base64: string;
  mimeType: string;
  fileName?: string;
}

export interface AiQuickAction {
  type: 'koleksi' | 'tiket' | 'tentang';
  label: string;
  route: string;
}

export interface AiMatchedCollection {
  id: number;
  kode: string;
  nama: string;
  kategori: string;
  lokasi: string;
}

export interface MuseumAiChatResponse {
  reply: string;
  mode: 'gemini' | 'local_fallback';
  model: string;
  followUpSuggestions: string[];
  quickActions: AiQuickAction[];
  matchedCollections: AiMatchedCollection[];
}

export const DEFAULT_PROMPT_STARTERS = [
  'Sejarah & makna Gerbong Maut',
  'Koleksi ikonik di halaman & ruang museum',
  'Rekomendasi rute tur 30 menit vs 1 jam',
  'Info jam buka, lokasi & cara pesan e-tiket',
];

const PLACEHOLDER_API_KEYS = ['replace-with', 'your_gemini_api_key', 'your-gemini-api-key'];

function getConfiguredGeminiApiKey(): string | null {
  const readKey = (): string | null => {
    const key = process.env.GEMINI_API_KEY?.trim() || '';
    if (!key) return null;
    const lower = key.toLowerCase();
    if (PLACEHOLDER_API_KEYS.some((p) => lower.includes(p))) return null;
    return key;
  };

  const existing = readKey();
  if (existing) return existing;

  dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
  return readKey();
}

function getCandidateGeminiModels(): string[] {
  const configured = process.env.GEMINI_MODEL?.trim();
  const defaults = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
  if (!configured) return defaults;
  return [configured, ...defaults.filter((m) => m !== configured)];
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatRupiah(amount: number): string {
  return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
}

/**
 * Mencocokkan koleksi dari database MySQL berdasarkan nama, kode, kategori, lokasi, dan sinonim kata kunci.
 */
function findMatchingCollections(
  queryText: string,
  collections: GroundedCollectionItem[],
): GroundedCollectionItem[] {
  const normalized = normalizeText(queryText);
  if (!normalized) return [];

  const tokens = normalized.split(' ').filter((w) => w.length >= 3);
  const scored: Array<{ item: GroundedCollectionItem; score: number }> = [];

  for (const item of collections) {
    let score = 0;
    const itemName = normalizeText(item.nama);
    const itemCategory = normalizeText(item.kategori);
    const itemLocation = normalizeText(item.lokasi);
    const itemCode = normalizeText(item.kode);
    const itemSummary = normalizeText(`${item.sub_deskripsi} ${item.deskripsi_lengkap}`);

    if (itemName && normalized.includes(itemName)) {
      score += 12;
    }
    if (itemCode && normalized.includes(itemCode)) {
      score += 10;
    }

    for (const token of tokens) {
      if (itemName.includes(token)) score += 4;
      if (itemCategory.includes(token)) score += 2;
      if (itemLocation.includes(token)) score += 1.5;
      if (itemSummary.includes(token)) score += 1;
    }

    // Sinonim spesifik koleksi populer Museum Brawijaya
    if ((normalized.includes('gerbong') || normalized.includes('bondowoso')) && itemName.includes('gerbong')) {
      score += 10;
    }
    if ((normalized.includes('sungkono') || normalized.includes('desoto') || normalized.includes('mobil')) && itemName.includes('mobil')) {
      score += 8;
    }
    if ((normalized.includes('sudirman') || normalized.includes('patung')) && itemName.includes('sudirman')) {
      score += 8;
    }
    if ((normalized.includes('tank') || normalized.includes('amfibi')) && itemName.includes('tank')) {
      score += 8;
    }
    if ((normalized.includes('perahu') || normalized.includes('segigir')) && itemName.includes('perahu')) {
      score += 8;
    }
    if ((normalized.includes('meriam') || normalized.includes('artileri') || normalized.includes('jagur') || normalized.includes('buang')) && itemName.includes('meriam')) {
      score += 8;
    }
    if ((normalized.includes('katana') || normalized.includes('pedang') || normalized.includes('jepang')) && itemName.includes('katana')) {
      score += 8;
    }
    if ((normalized.includes('peta') || normalized.includes('dokumen') || normalized.includes('arsip')) && (itemName.includes('peta') || itemCategory.includes('dokumen'))) {
      score += 7;
    }
    if ((normalized.includes('seragam') || normalized.includes('pakaian') || normalized.includes('baju')) && (itemName.includes('seragam') || itemCategory.includes('pakaian'))) {
      score += 7;
    }

    if (score >= 4) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((s) => s.item);
}

/**
 * Guardrail: mendeteksi topik yang jelas-jelas di luar ruang lingkup Museum Brawijaya / sejarah perjuangan / wisata Malang.
 */
function isClearlyOutOfScope(message: string): boolean {
  const norm = normalizeText(message);
  if (!norm) return false;

  const museumSignals = [
    'museum', 'brawijaya', 'malang', 'ijen', 'gerbong', 'maut', 'koleksi', 'artefak',
    'tiket', 'eticket', 'e tiket', 'harga', 'jam buka', 'operasional', 'lokasi', 'alamat',
    'rute', 'tur', 'tour', 'sejarah', 'perjuangan', 'kemerdekaan', 'tni', 'kodam', 'pahlawan',
    'sudirman', 'soerachman', 'sungkono', 'tank', 'meriam', 'senjata', 'katana', 'perahu',
    'segigir', 'mobil', 'seragam', 'peta', 'diorama', 'wisata', 'edukasi', 'berkunjung',
    'kunjungan', 'parkir', 'kamera', 'foto', 'pelajar', 'rombongan', 'jawa timur', 'bondowoso',
    'surabaya', '1945', '1947', '1968', 'perang', 'gerilya', 'tentara', 'pejuang', 'batalyon',
  ];

  if (museumSignals.some((kw) => norm.includes(kw))) {
    return false;
  }

  const outOfScopeKeywords = [
    'python', 'javascript', 'react', 'coding', 'koding', 'program', 'algoritma', 'html', 'css', 'sql',
    'resep', 'masak', 'goreng', 'nasi goreng', 'soto', 'kue', 'kalori', 'diet',
    'bitcoin', 'kripto', 'crypto', 'saham', 'forex', 'trading', 'investasi',
    'ramalan', 'zodiak', 'horoskop', 'jodoh', 'pacar', 'cinta', 'galau',
    'integral', 'turunan', 'matematika', 'fisika', 'kimia', 'biologi', 'rumus',
    'obat', 'penyakit', 'gejala', 'dokter', 'diagnosa',
    'sepak bola', 'bola', 'liga', 'premier league', 'valorant', 'mobile legends', 'minecraft',
    'film', 'drakor', 'anime', 'lirik lagu', 'chord gitar',
    'translate', 'terjemahkan', 'puisi cinta', 'cerpen',
  ];

  return outOfScopeKeywords.some((kw) => norm.includes(kw));
}

function isFollowUpMessage(message: string): boolean {
  const norm = normalizeText(message);
  const followUpSignals = [
    'lebih detail', 'lebih lanjut', 'ceritakan lagi', 'jelaskan lagi', 'tentang itu',
    'soal itu', 'tersebut', 'yang tadi', 'yang sebelumnya', 'selain itu', 'lalu bagaimana',
    'terus bagaimana', 'kalau yang lebih singkat', 'lebih singkat', 'lebih cepat',
    'kalau 30 menit', 'kalau 1 jam', 'kalau 2 jam', 'bagaimana caranya', 'terus', 'lanjutkan',
    'detailnya', 'maknanya', 'dimana letaknya', 'ada lagi',
  ];
  return followUpSignals.some((sig) => norm.includes(sig)) || norm.split(' ').length <= 4;
}

function detectTopicFromText(text: string): string | null {
  const norm = normalizeText(text);
  if (norm.includes('gerbong') || norm.includes('bondowoso')) return 'gerbong_maut';
  if (norm.includes('rute') || norm.includes('tur') || norm.includes('tour') || norm.includes('30 menit') || norm.includes('1 jam') || norm.includes('itinerary')) return 'rute_tur';
  if (norm.includes('tiket') || norm.includes('harga') || norm.includes('biaya') || norm.includes('bayar') || norm.includes('pesan') || norm.includes('qris') || norm.includes('midtrans')) return 'tiket';
  if (norm.includes('jam') || norm.includes('buka') || norm.includes('tutup') || norm.includes('libur') || norm.includes('alamat') || norm.includes('lokasi') || norm.includes('maps') || norm.includes('telepon') || norm.includes('kontak')) return 'jam_lokasi';
  if (norm.includes('koleksi') || norm.includes('artefak') || norm.includes('pamer') || norm.includes('senjata') || norm.includes('kendaraan') || norm.includes('tank') || norm.includes('meriam') || norm.includes('katana') || norm.includes('perahu') || norm.includes('mobil') || norm.includes('seragam') || norm.includes('peta')) return 'koleksi';
  if (norm.includes('sejarah') || norm.includes('berdiri') || norm.includes('soerachman') || norm.includes('1968') || norm.includes('visi') || norm.includes('misi') || norm.includes('sudirman') || norm.includes('brawijaya')) return 'sejarah';
  if (norm.includes('faq') || norm.includes('kamera') || norm.includes('foto') || norm.includes('flash') || norm.includes('aturan') || norm.includes('tata tertib')) return 'faq';
  return null;
}

function detectQuickActions(
  combinedText: string,
  matchedCollections: GroundedCollectionItem[],
): AiQuickAction[] {
  const norm = normalizeText(combinedText);
  const actions: AiQuickAction[] = [];
  const added = new Set<string>();

  const pushUnique = (action: AiQuickAction) => {
    if (!added.has(action.type)) {
      added.add(action.type);
      actions.push(action);
    }
  };

  if (
    matchedCollections.length > 0 ||
    norm.includes('koleksi') ||
    norm.includes('artefak') ||
    norm.includes('gerbong') ||
    norm.includes('tank') ||
    norm.includes('senjata') ||
    norm.includes('ruang pamer')
  ) {
    pushUnique({
      type: 'koleksi',
      label: 'Jelajahi Koleksi',
      route: '/koleksi',
    });
  }

  if (
    norm.includes('tiket') ||
    norm.includes('harga') ||
    norm.includes('pesan') ||
    norm.includes('kunjungan') ||
    norm.includes('rute') ||
    norm.includes('jam buka') ||
    norm.includes('berkunjung')
  ) {
    pushUnique({
      type: 'tiket',
      label: 'Pesan E-Tiket',
      route: '/tiket',
    });
  }

  if (
    norm.includes('lokasi') ||
    norm.includes('alamat') ||
    norm.includes('peta') ||
    norm.includes('sejarah berdiri') ||
    norm.includes('visi') ||
    norm.includes('tentang museum')
  ) {
    pushUnique({
      type: 'tentang',
      label: 'Info & Lokasi Museum',
      route: '/tentang',
    });
  }

  return actions.slice(0, 3);
}

function deriveFollowUpSuggestions(
  topic: string | null,
  matchedCollections: GroundedCollectionItem[],
  isOutOfScope: boolean,
): string[] {
  if (isOutOfScope) {
    return [
      'Sejarah & makna Gerbong Maut',
      'Rekomendasi rute tur 30 menit vs 1 jam',
      'Info jam buka & harga tiket masuk',
    ];
  }

  if (topic === 'gerbong_maut') {
    return [
      'Ceritakan lebih detail kronologi Peristiwa Gerbong Maut 1947',
      'Koleksi ikonik apa lagi yang ada dekat Gerbong Maut?',
      'Rekomendasi rute tur 30 menit di Museum Brawijaya',
    ];
  }

  if (topic === 'rute_tur') {
    return [
      'Kalau rute yang lebih singkat (20-30 menit) bagaimana?',
      'Koleksi wajib dilihat di Ruang Pamer I & II',
      'Berapa harga tiket masuk & cara pesan e-tiket?',
    ];
  }

  if (topic === 'tiket' || topic === 'jam_lokasi') {
    return [
      'Rekomendasi rute tur 30 menit vs 1 jam',
      'Aturan foto & tips berkunjung ke Museum Brawijaya',
      'Koleksi paling terkenal di Museum Brawijaya',
    ];
  }

  if (matchedCollections.length > 0) {
    const first = matchedCollections[0];
    return [
      `Ceritakan lebih detail tentang ${first.nama}`,
      'Koleksi ikonik lainnya di Museum Brawijaya',
      'Rekomendasi rute tur 1 jam mencakup koleksi ini',
    ];
  }

  if (topic === 'sejarah') {
    return [
      'Sejarah & makna Gerbong Maut',
      'Koleksi ikonik di halaman & ruang museum',
      'Info jam buka, lokasi & harga tiket',
    ];
  }

  return [
    'Sejarah & makna Gerbong Maut',
    'Koleksi ikonik di halaman & ruang museum',
    'Info jam buka, lokasi & cara pesan e-tiket',
  ];
}

function buildSystemInstruction(snapshot: MuseumKnowledgeSnapshot, visitorName?: string): string {
  const groundedContext = buildGroundedContextBlock(snapshot);
  const greetingHint = visitorName?.trim()
    ? `Nama pengunjung yang sedang berbicara denganmu adalah "${visitorName.trim()}". Sapa secara hangat bila relevan tanpa berlebihan.`
    : '';

  return [
    'Kamu adalah **Pemandu Virtual Resmi Museum Brawijaya Malang** (Asisten AI resmi di aplikasi Museum Brawijaya).',
    greetingHint,
    '',
    '=== GAYA KOMUNIKASI & FORMAT ===',
    '1. Jawablah dengan ramah, edukatif, akurat, dan terstruktur layaknya asisten modern (Gemini/ChatGPT/Claude).',
    '2. Gunakan Markdown yang rapi: **tebal** untuk istilah/nama penting, daftar poin (bullet / bernomor) agar mudah dibaca di layar HP maupun desktop, serta ringkasan singkat bila topik panjang.',
    '3. Gunakan Bahasa Indonesia secara default (atau balas dalam Bahasa Inggris jika pengunjung bertanya dalam Bahasa Inggris).',
    '4. Ingat dan manfaatkan riwayat percakapan sebelumnya untuk menjawab pertanyaan lanjutan (misalnya "ceritakan lebih detail tentang itu" atau "kalau rute yang lebih singkat bagaimana?").',
    '5. Selalu utamakan data aktual dari database Museum Brawijaya di bawah ini (harga tiket, jam operasional, daftar koleksi, lokasi ruang, pengumuman, FAQ). Jangan mengarang harga tiket, jam buka, atau kode inventaris yang tidak ada di data.',
    '6. Jika pengunjung melampirkan gambar/foto (misalnya foto koleksi, artefak, kendaraan tempur, senjata, seragam, dokumen, papan informasi, atau suasana Museum Brawijaya), analisis detail visual pada gambar secara cermat, identifikasi apakah berkaitan dengan koleksi atau sejarah Museum Brawijaya, cocokkan dengan data katalog bila relevan, dan berikan penjelasan yang informatif serta terstruktur.',
    '',
    '=== GUARDRAIL KETAT (BATASAN TOPIK) ===',
    '- Kamu HANYA melayani topik yang berkaitan dengan: Museum Brawijaya Malang, koleksi & artefak museum, sejarah perjuangan kemerdekaan Indonesia / Jawa Timur / Kodam V Brawijaya / TNI, rute tur & tips kunjungan museum, tiket & fasilitas Museum Brawijaya, serta wisata edukasi/sejarah di Kota Malang.',
    '- Jika pengunjung bertanya topik atau mengirim gambar yang sama sekali tidak berkaitan (seperti pemrograman/coding, resep masakan, soal matematika, kripto/saham, hiburan/film, medis, dll.), tolaklah dengan sangat sopan dalam 2-3 kalimat, jelaskan peranmu sebagai Pemandu Virtual Resmi Museum Brawijaya Malang, dan tawarkan topik menarik seputar Museum Brawijaya.',
    '',
    groundedContext,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

/**
 * Engine Fallback Lokal Cerdas berbasis live data MySQL + multi-turn context awareness.
 * Berjalan otomatis bila GEMINI_API_KEY belum diatur atau layanan Gemini sedang tidak terjangkau.
 */
function generateSmartLocalReply(
  messages: ChatHistoryMessage[],
  snapshot: MuseumKnowledgeSnapshot,
  visitorName?: string,
  image?: ChatImageAttachment,
): MuseumAiChatResponse {
  const lastUserMsg = messages[messages.length - 1]?.content.trim() || '';
  const norm = normalizeText(lastUserMsg);
  const priorMessages = messages.slice(0, -1);

  if (image) {
    const matchedFromCaption = findMatchingCollections(
      `${lastUserMsg} ${image.fileName || ''}`,
      snapshot.collections,
    );
    const primary = matchedFromCaption[0];
    const reply = primary
      ? [
          `Saya menerima gambar yang Anda unggah${image.fileName ? ` (**${image.fileName}**)` : ''}. Saat ini layanan analisis visual Gemini sedang dalam mode cadangan, namun berdasarkan informasi yang Anda berikan, koleksi yang paling relevan adalah **${primary.nama}** (${primary.kode}):`,
          '',
          primary.deskripsi_lengkap || primary.sub_deskripsi,
          '',
          `- **Kategori:** ${primary.kategori}`,
          `- **Tahun / Era:** ${primary.tahun || '-'}`,
          `- **Lokasi Ruang:** ${primary.lokasi || '-'}`,
          '',
          '*Silakan kirim ulang beberapa saat lagi untuk analisis visual otomatis langsung dari Gemini Vision.*',
        ].join('\n')
      : [
          `Saya menerima gambar yang Anda unggah${image.fileName ? ` (**${image.fileName}**)` : ''}. 🖼️`,
          '',
          'Saat ini analisis visual otomatis sedang sementara berada pada **mode cadangan**, sehingga saya belum bisa membaca detail foto secara langsung.',
          '',
          'Agar tetap bisa membantu sekarang, Anda bisa menyebutkan **nama benda/koleksi** yang ada di foto (misalnya *Gerbong Maut*, *Tank Amfibi*, *Meriam Si Buang*, *Mobil Dinas Letkol*, atau *Perahu Segigir*), atau coba kirim ulang gambar beberapa saat lagi.',
        ].join('\n');

    return {
      reply,
      mode: 'local_fallback',
      model: 'museum-knowledge-engine',
      followUpSuggestions: deriveFollowUpSuggestions('koleksi', matchedFromCaption, false),
      quickActions: [
        { type: 'koleksi', label: 'Jelajahi Koleksi', route: '/koleksi' },
        { type: 'tiket', label: 'Pesan E-Tiket', route: '/tiket' },
      ],
      matchedCollections: matchedFromCaption.map((c) => ({
        id: c.id,
        kode: c.kode,
        nama: c.nama,
        kategori: c.kategori,
        lokasi: c.lokasi,
      })),
    };
  }

  // Cari konteks dari percakapan sebelumnya untuk pertanyaan lanjutan
  let priorTopic: string | null = null;
  let priorCollections: GroundedCollectionItem[] = [];
  for (let i = priorMessages.length - 1; i >= 0; i--) {
    const msg = priorMessages[i];
    if (!priorTopic) {
      priorTopic = detectTopicFromText(msg.content);
    }
    if (priorCollections.length === 0) {
      const found = findMatchingCollections(msg.content, snapshot.collections);
      if (found.length > 0) priorCollections = found;
    }
    if (priorTopic && priorCollections.length > 0) break;
  }

  // 1. Cek Guardrail Out-of-Scope
  if (isClearlyOutOfScope(lastUserMsg)) {
    const reply = [
      'Mohon maaf, sebagai **Pemandu Virtual Resmi Museum Brawijaya Malang**, saya hanya dapat membantu pertanyaan seputar **Museum Brawijaya**, koleksi artefak bersejarah, sejarah perjuangan TNI/Brawijaya, serta informasi kunjungan & wisata edukasi di Malang.',
      '',
      'Saya akan sangat senang jika dapat membantu Anda menjelajahi topik berikut:',
      '- **Kisah & makna Gerbong Maut 1947** beserta koleksi bersejarah lainnya',
      '- **Rekomendasi rute tur** (30 menit vs 1 jam) sesuai waktu kunjungan Anda',
      '- **Informasi jam buka, lokasi, harga tiket, dan cara pesan e-tiket**',
    ].join('\n');

    return {
      reply,
      mode: 'local_fallback',
      model: 'museum-knowledge-engine',
      followUpSuggestions: deriveFollowUpSuggestions(null, [], true),
      quickActions: [
        { type: 'koleksi', label: 'Jelajahi Koleksi', route: '/koleksi' },
        { type: 'tiket', label: 'Pesan E-Tiket', route: '/tiket' },
      ],
      matchedCollections: [],
    };
  }

  // 2. Sapaan Awal
  const isGreeting = /^(halo|hai|hello|hi|selamat pagi|selamat siang|selamat sore|selamat malam|assalamualaikum|permisi|siapa kamu|kamu siapa)\b/.test(norm) && norm.split(' ').length <= 5;
  if (isGreeting) {
    const sapaan = visitorName?.trim() ? `Halo, **${visitorName.trim()}**!` : 'Halo, Pengunjung!';
    const reply = [
      `${sapaan} Selamat datang di **Asisten AI Museum Brawijaya Malang**. 👋`,
      '',
      'Saya adalah pemandu virtual yang terhubung langsung dengan katalog koleksi dan informasi resmi museum. Anda dapat menanyakan:',
      '- **Koleksi & Artefak** (misalnya *Gerbong Maut*, *Tank Amfibi*, *Mobil Dinas Letkol*, *Perahu Segigir*)',
      '- **Rekomendasi Rute Tur** (tur singkat 30 menit, lengkap 1 jam, atau tur edukasi pelajar)',
      '- **Info Kunjungan & E-Tiket** (jam operasional, harga tiket terbaru, lokasi, dan tata tertib)',
      '- **Sejarah Perjuangan** berdirinya Museum Brawijaya dan peran Divisi Brawijaya',
      '',
      'Ada topik atau koleksi tertentu yang ingin Anda ketahui terlebih dahulu?',
    ].join('\n');

    return {
      reply,
      mode: 'local_fallback',
      model: 'museum-knowledge-engine',
      followUpSuggestions: DEFAULT_PROMPT_STARTERS.slice(0, 3),
      quickActions: [
        { type: 'koleksi', label: 'Jelajahi Koleksi', route: '/koleksi' },
        { type: 'tiket', label: 'Pesan E-Tiket', route: '/tiket' },
      ],
      matchedCollections: [],
    };
  }

  // 3. Resolusi topik & koleksi (mempertimbangkan multi-turn follow-up)
  const currentTopic = detectTopicFromText(lastUserMsg);
  const directCollections = findMatchingCollections(lastUserMsg, snapshot.collections);
  const wantsMoreDetail = isFollowUpMessage(lastUserMsg);
  const activeTopic = currentTopic ?? (wantsMoreDetail ? priorTopic : null);
  const activeCollections = directCollections.length > 0
    ? directCollections
    : (wantsMoreDetail ? priorCollections : []);

  const wantsShorterRoute =
    norm.includes('lebih singkat') ||
    norm.includes('lebih cepat') ||
    norm.includes('20 menit') ||
    norm.includes('30 menit') ||
    norm.includes('kilat') ||
    norm.includes('ekspres');

  let reply = '';

  // 4A. Handler Rute Tur (termasuk multi-turn "kalau rute yang lebih singkat bagaimana?")
  if (activeTopic === 'rute_tur' || wantsShorterRoute) {
    if (wantsShorterRoute && priorTopic === 'rute_tur') {
      reply = [
        '### ⚡ Rute Tur Ekspres Museum Brawijaya (20–30 Menit)',
        'Jika waktu kunjungan Anda terbatas, berikut rute paling efisien untuk tetap melihat seluruh ikon utama museum:',
        '',
        '1. **Halaman Depan / Agne Yastra Loka (5 menit)** — Amati langsung **Tank Amfibi** dan **Meriam Artileri** di area terbuka.',
        '2. **Lobby Utama (5 menit)** — Melihat **Patung Jenderal Sudirman**, relief perjuangan, dan lambang Kodam V/Brawijaya.',
        '3. **Halaman Tengah — Gerbong Maut & Perahu Segigir (10 menit)** — Titik paling bersejarah; baca kisah heroik Peristiwa Gerbong Maut 1947 dan dokumentasi foto.',
        '4. **Ruang Pamer I Highlight (10 menit)** — Fokus pada **Mobil Dinas Kolonel Sungkono**, senjata perjuangan 1945–1949, dan meja perundingan.',
        '',
        '**Tips cepat:** Pesan e-tiket lewat menu **Tiket** sebelum tiba agar langsung *check-in* tanpa antre di loket.',
      ].join('\n');
    } else {
      reply = [
        '### 🗺️ Rekomendasi Rute Tur Museum Brawijaya Malang',
        'Anda dapat menyesuaikan alur kunjungan berdasarkan waktu yang tersedia:',
        '',
        '**1. Rute Singkat — 30 Menit (Highlight Utama)**',
        '- **Menit 0–5:** Halaman Depan (*Agne Yastra Loka*) — melihat **Tank Amfibi** dan artileri berat.',
        '- **Menit 5–10:** Lobby Utama — **Patung Jenderal Sudirman** & pengenalan sejarah Museum Brawijaya.',
        '- **Menit 10–20:** Halaman Tengah — menyaksikan langsung **Gerbong Maut** dan **Perahu Segigir**.',
        '- **Menit 20–30:** Ruang Pamer I — melihat **Mobil Dinas Letkol/Kolonel Sungkono** & koleksi senjata kemerdekaan.',
        '',
        '**2. Rute Lengkap — 60 Menit (Rekomendasi Ideal)**',
        '- Mengikuti seluruh jalur 30 menit di atas dengan tempo lebih santai (+15 menit untuk membaca narasi sejarah).',
        '- **Menit 40–55:** **Ruang Pamer II** — menjelajahi koleksi era 1950–1976, **Dokumen Peta Strategi Perang**, **Seragam Dinas TNI**, dan diorama pertempuran.',
        '- **Menit 55–60:** Area Perpustakaan Sejarah & spot foto kenang-kenangan di halaman museum.',
        '',
        `**Jam Operasional:** ${snapshot.operatingHours.hari}, pukul **${snapshot.operatingHours.jam}**.`,
      ].join('\n');
    }
  }
  // 4B. Handler Gerbong Maut (termasuk follow-up "ceritakan lebih detail tentang itu")
  else if (activeTopic === 'gerbong_maut') {
    const gerbongItem = snapshot.collections.find((c) => normalizeText(c.nama).includes('gerbong'));
    const isDetailFollowUp = wantsMoreDetail && priorTopic === 'gerbong_maut';

    if (isDetailFollowUp) {
      reply = [
        '### 🚂 Detail Sejarah & Kronologi Peristiwa Gerbong Maut (23 November 1947)',
        '',
        '**Latar Belakang Kejadian:**',
        'Pasca Agresi Militer Belanda I tahun 1947, tentara Belanda menangkap para pejuang kemerdekaan di wilayah Bondowoso dan sekitarnya. Pada **23 November 1947**, sebanyak **100 pejuang** dipindahkan dari penjara Bondowoso menuju Penjara Kalisosok, Surabaya menggunakan 3 gerbong barang kereta api yang tertutup rapat tanpa ventilasi memadai.',
        '',
        '**Kondisi di Dalam Gerbong:**',
        '- Perjalanan berlangsung sekitar **16 jam** di bawah terik matahari Jawa Timur.',
        '- Gerbong **GR 10152** yang kini tersimpan di Museum Brawijaya memiliki dinding besi/kayu tertutup rapat sehingga suhu di dalam sangat panas dan oksigen menipis.',
        '- Para tawanan tidak diberi makanan maupun air minum yang layak; saat tiba di Stasiun Wonokromo Surabaya, **46 pejuang gugur**, 11 sakit parah, 31 sakit ringan, dan hanya 12 orang yang masih sehat.',
        '',
        '**Makna Edukatif Saat Ini:**',
        `- Nomor Inventaris Database: **${gerbongItem?.kode || '#INV-MB-001'}** | Lokasi: **${gerbongItem?.lokasi || 'Halaman Tengah Museum Brawijaya'}**.`,
        '- Gerbong Maut melambangkan betapa mahalnya harga kemerdekaan Indonesia dan menjadi pengingat bagi generasi muda untuk menjaga persatuan bangsa.',
      ].join('\n');
    } else {
      reply = [
        `### 🚂 ${gerbongItem?.nama || 'Gerbong Maut'} (${gerbongItem?.kode || '#INV-MB-001'})`,
        '',
        gerbongItem?.deskripsi_lengkap ||
          'Gerbong Maut adalah gerbong kereta api barang bersejarah yang menjadi saksi bisu tragedi **23 November 1947**, ketika 100 pejuang kemerdekaan yang ditawan Belanda diangkut dari Bondowoso menuju Surabaya dalam kondisi gerbong tertutup rapat tanpa udara dan air sehingga **46 pejuang gugur**.',
        '',
        '**Informasi Koleksi (Data Resmi Museum):**',
        `- **Kategori:** ${gerbongItem?.kategori || 'Kendaraan'}`,
        `- **Era / Tahun:** ${gerbongItem?.tahun || '1947'}`,
        `- **Lokasi Pamer:** ${gerbongItem?.lokasi || 'Halaman Tengah / Depan'}`,
        `- **Status:** ${gerbongItem?.status || 'DIPAMERKAN'}`,
        '',
        '**Makna Historis:**',
        'Koleksi ini mengingatkan pengunjung akan pengorbanan luar biasa rakyat dan pejuang Jawa Timur dalam mempertahankan kemerdekaan Republik Indonesia. Jika Anda ingin, tanyakan *"ceritakan lebih detail"* untuk kronologi lengkap perjalanannya!',
      ].join('\n');
    }
  }
  // 4C. Handler Tiket & Harga (Live Database)
  else if (activeTopic === 'tiket') {
    const ticketRows = snapshot.ticketCategories
      .map((t) => `- **${t.title}** (${t.badge}): **${formatRupiah(t.price)}**`)
      .join('\n');

    reply = [
      '### 🎫 Informasi Tiket & Cara Pesan E-Tiket Museum Brawijaya',
      '',
      '**Daftar Harga Tiket Resmi (Data Terbaru):**',
      ticketRows,
      '',
      '**Sesi Kunjungan yang Tersedia:**',
      '- Sesi 1: **08:00 – 10:00 WIB**',
      '- Sesi 2: **10:00 – 12:00 WIB**',
      '- Sesi 3: **13:00 – 15:00 WIB**',
      '',
      '**Cara Pemesanan E-Tiket di Aplikasi:**',
      '1. Buka menu **Tiket** di navigasi bawah (atau klik tombol **Pesan E-Tiket** di bawah jawaban ini).',
      '2. Pilih tanggal kunjungan, sesi waktu, serta jumlah tiket sesuai kategori.',
      '3. Lengkapi data pengunjung dan selesaikan pembayaran secara aman.',
      '4. Tunjukkan e-tiket / kode pemesanan Anda di loket saat tiba di museum.',
      '',
      `*Catatan: Pengunjung juga tetap dapat membeli tiket secara langsung (OTS) di loket pada jam operasional (${snapshot.operatingHours.hari}, ${snapshot.operatingHours.jam}).*`,
    ].join('\n');
  }
  // 4D. Handler Jam Operasional, Lokasi, & Pengumuman (Live Database)
  else if (activeTopic === 'jam_lokasi') {
    const announcementBlock = snapshot.announcements.length > 0
      ? [
          '',
          '**Pengumuman Aktif Museum:**',
          ...snapshot.announcements.slice(0, 3).map((a) => `- **${a.title}** (${a.date}): ${a.description}`),
        ]
      : [];

    reply = [
      '### 📍 Lokasi, Jam Operasional & Kontak Museum Brawijaya',
      '',
      `- **Alamat Lengkap:** Jl. Besar Ijen No. 25A, Gading Kasri, Kec. Klojen, Kota Malang, Jawa Timur 65115`,
      `- **Hari Buka:** ${snapshot.operatingHours.hari}`,
      `- **Jam Operasional:** ${snapshot.operatingHours.jam}`,
      `- **Telepon Resmi:** ${snapshot.operatingHours.telepon}`,
      '',
      '**Akses & Lokasi:**',
      'Museum terletak strategis di koridor ikonik **Jalan Ijen** pusat Kota Malang, mudah dijangkau kendaraan pribadi, transportasi online, maupun bus rombongan sekolah.',
      ...announcementBlock,
    ].join('\n');
  }
  // 4E. Handler Koleksi Spesifik dari MySQL
  else if (activeCollections.length > 0 && !norm.includes('daftar semua') && !norm.includes('koleksi ikonik')) {
    const primary = activeCollections[0];
    const others = activeCollections.slice(1);
    reply = [
      `### 🏛️ ${primary.nama} (${primary.kode})`,
      '',
      primary.deskripsi_lengkap || primary.sub_deskripsi,
      '',
      '**Detail Katalog Museum (Data Database):**',
      `- **Kategori:** ${primary.kategori}`,
      `- **Tahun / Era:** ${primary.tahun || '-'}`,
      `- **Lokasi Ruang:** ${primary.lokasi || '-'}`,
      `- **Status Pamer:** ${primary.status}`,
      ...(others.length > 0
        ? [
            '',
            '**Koleksi Terkait Lainnya:**',
            ...others.map((o) => `- **${o.nama}** (${o.kategori}, ${o.tahun || '-'}) — *${o.lokasi}*`),
          ]
        : []),
    ].join('\n');
  }
  // 4F. Handler Daftar / Koleksi Ikonik (Live Database)
  else if (activeTopic === 'koleksi') {
    const displayed = snapshot.collections.filter((c) => c.status.toUpperCase() === 'DIPAMERKAN');
    const sourceList = displayed.length > 0 ? displayed : snapshot.collections;
    const byCategory = new Map<string, GroundedCollectionItem[]>();
    for (const item of sourceList) {
      const cat = item.kategori || 'Lainnya';
      const arr = byCategory.get(cat) ?? [];
      arr.push(item);
      byCategory.set(cat, arr);
    }

    const lines: string[] = [
      `### 🎖️ Koleksi Ikonik Museum Brawijaya (${sourceList.length} Koleksi Terdata)`,
      'Berikut beberapa koleksi bersejarah yang dapat Anda saksikan langsung di halaman dan ruang pamer museum:',
      '',
    ];

    for (const [category, items] of byCategory.entries()) {
      lines.push(`**Kategori ${category}:**`);
      for (const item of items.slice(0, 4)) {
        lines.push(`- **${item.nama}** (${item.tahun || '-'}) — *${item.lokasi}*. ${item.sub_deskripsi}`);
      }
      lines.push('');
    }

    lines.push('Ingin saya ceritakan lebih detail tentang salah satu koleksi di atas? Sebut saja namanya!');
    reply = lines.join('\n').trim();
  }
  // 4G. Handler Sejarah Museum Brawijaya
  else if (activeTopic === 'sejarah') {
    reply = [
      '### 📜 Sejarah Berdirinya Museum Brawijaya Malang',
      '',
      '- **Gagasan Awal (1962):** Diprakarsai oleh **Brigjen TNI (Purn.) Soerachman**, Pangdam VIII/Brawijaya periode 1959–1962, untuk melestarikan benda bukti perjuangan dan mewariskan nilai-nilai kejuangan 1945.',
      '- **Pembangunan & Peresmian:** Pembangunan gedung dimulai pada tahun **1967** di atas lahan Jalan Besar Ijen No. 25A (rancangan arsitek Ir. Soemadi), dan secara resmi diresmikan pada **4 Mei 1968** oleh **Kolonel Dr. Soewondo**.',
      '- **Motto Museum:** ***Citra Uthapana Cakra*** yang bermakna sinar yang membangkitkan semangat atau kekuatan perjuangan.',
      '- **Ruang Pamer:** Terbagi atas **Halaman Depan** (*Agne Yastra Loka*), **Lobby Utama**, **Ruang Pamer I** (era 1945–1949), **Halaman Tengah** (*Gerbong Maut* & *Perahu Segigir*), serta **Ruang Pamer II** (era 1950–1976).',
    ].join('\n');
  }
  // 4H. Handler FAQ / Tata Tertib
  else if (activeTopic === 'faq') {
    const faqLines = snapshot.faqs
      .slice(0, 5)
      .map((f, idx) => `${idx + 1}. **${f.question}**\n   ${f.answer}`)
      .join('\n\n');

    reply = [
      '### ℹ️ Panduan Kunjungan & FAQ Museum Brawijaya',
      '',
      faqLines,
    ].join('\n');
  }
  // 4I. Default Helpful Museum Overview
  else {
    reply = [
      'Terima kasih atas pertanyaan Anda mengenai **Museum Brawijaya Malang**! 🏛️',
      '',
      'Berikut ringkasan informasi utama yang bisa saya bantu jelaskan lebih lanjut:',
      `- **Koleksi Unggulan:** Tersedia **${snapshot.collections.length} koleksi** terdata di katalog aplikasi, termasuk **Gerbong Maut (1947)**, **Tank Amfibi**, **Mobil Dinas Letkol**, **Perahu Segigir**, dan **Dokumen Peta Strategi Perang**.`,
      `- **Jam Operasional:** ${snapshot.operatingHours.hari}, pukul **${snapshot.operatingHours.jam}**.`,
      `- **Tiket Masuk:** Mulai dari **${formatRupiah(Math.min(...snapshot.ticketCategories.map((t) => t.price)))}** (dapat dipesan via menu **Tiket**).`,
      '- **Alamat:** Jl. Besar Ijen No. 25A, Klojen, Kota Malang.',
      '',
      'Silakan tanyakan koleksi spesifik, sejarah perjuangan, rekomendasi rute tur, atau info tiket yang ingin Anda ketahui!',
    ].join('\n');
  }

  const matchedCollections: AiMatchedCollection[] = activeCollections.map((c) => ({
    id: c.id,
    kode: c.kode,
    nama: c.nama,
    kategori: c.kategori,
    lokasi: c.lokasi,
  }));

  const quickActions = detectQuickActions(`${lastUserMsg} ${reply}`, activeCollections);
  const followUpSuggestions = deriveFollowUpSuggestions(activeTopic, activeCollections, false);

  return {
    reply,
    mode: 'local_fallback',
    model: 'museum-knowledge-engine',
    followUpSuggestions,
    quickActions,
    matchedCollections,
  };
}

/**
 * Menjalankan percakapan multi-turn dengan Gemini API (ter-grounding database MySQL)
 * dengan fallback otomatis ke Smart Local Knowledge Engine jika GEMINI_API_KEY belum diisi atau terjadi gangguan.
 */
export async function generateMuseumAiReply(params: {
  messages: ChatHistoryMessage[];
  visitorName?: string;
  image?: ChatImageAttachment;
}): Promise<MuseumAiChatResponse> {
  const snapshot = await getMuseumKnowledgeSnapshot();
  const sanitizedMessages = params.messages.slice(-16);
  const lastUserMessage = sanitizedMessages[sanitizedMessages.length - 1];
  const apiKey = getConfiguredGeminiApiKey();

  if (!apiKey || !lastUserMessage) {
    return generateSmartLocalReply(sanitizedMessages, snapshot, params.visitorName, params.image);
  }

  const systemInstruction = buildSystemInstruction(snapshot, params.visitorName);
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelsToTry = getCandidateGeminiModels();

  // Format history sesuai kontrak Gemini: harus dimulai dari role 'user' dan bergantian
  const rawHistory = sanitizedMessages.slice(0, -1);
  const geminiHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const msg of rawHistory) {
    const mappedRole = msg.role === 'assistant' ? 'model' : 'user';
    if (geminiHistory.length === 0 && mappedRole !== 'user') continue;
    if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === mappedRole) {
      geminiHistory[geminiHistory.length - 1].parts[0].text += `\n${msg.content}`;
    } else {
      geminiHistory.push({
        role: mappedRole,
        parts: [{ text: msg.content }],
      });
    }
  }

  const timeoutMs = params.image ? 28_000 : 18_000;
  const userMessageInput = params.image
    ? [
        {
          inlineData: {
            mimeType: params.image.mimeType,
            data: params.image.base64,
          },
        },
        { text: lastUserMessage.content },
      ]
    : lastUserMessage.content;

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
      });

      const chat = model.startChat({
        history: geminiHistory,
        generationConfig: {
          temperature: 0.55,
          maxOutputTokens: 1024,
        },
      });

      const result = await Promise.race([
        chat.sendMessage(userMessageInput),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout ${timeoutMs / 1000}s pada model ${modelName}`)),
            timeoutMs,
          ),
        ),
      ]);
      const replyText = result.response.text().trim();

      if (replyText) {
        const combined = `${lastUserMessage.content}\n${replyText}`;
        const matchedItems = findMatchingCollections(combined, snapshot.collections);
        const topic = detectTopicFromText(lastUserMessage.content) ?? detectTopicFromText(replyText);
        const outOfScope = params.image ? false : isClearlyOutOfScope(lastUserMessage.content);

        return {
          reply: replyText,
          mode: 'gemini',
          model: modelName,
          followUpSuggestions: deriveFollowUpSuggestions(topic, matchedItems, outOfScope),
          quickActions: detectQuickActions(combined, matchedItems),
          matchedCollections: matchedItems.map((c) => ({
            id: c.id,
            kode: c.kode,
            nama: c.nama,
            kategori: c.kategori,
            lokasi: c.lokasi,
          })),
        };
      }
    } catch (err) {
      console.warn(`[AI CHAT] Model ${modelName} gagal, mencoba fallback berikutnya:`, err instanceof Error ? err.message : err);
    }
  }

  // Fallback otomatis ke engine lokal cerdas jika seluruh percobaan Gemini gagal
  return generateSmartLocalReply(sanitizedMessages, snapshot, params.visitorName, params.image);
}

export function isGeminiConfigured(): boolean {
  return Boolean(getConfiguredGeminiApiKey());
}
