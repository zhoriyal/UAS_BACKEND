import { koleksiModel } from '../models/koleksiModel';
import { informasiModel } from '../models/informasiModel';
import { tiketModel } from '../models/tiketModel';

export interface GroundedCollectionItem {
  id: number;
  kode: string;
  nama: string;
  sub_deskripsi: string;
  deskripsi_lengkap: string;
  kategori: string;
  tahun: string;
  lokasi: string;
  status: string;
}

export interface GroundedTicketCategory {
  id: number;
  badge: string;
  title: string;
  price: number;
  kuota: number;
  status: string;
}

export interface GroundedFaqItem {
  id: number;
  question: string;
  answer: string;
}

export interface GroundedAnnouncement {
  id: number;
  title: string;
  description: string;
  category: string;
  date: string;
  status: string;
}

export interface GroundedOperatingHours {
  hari: string;
  jam: string;
  telepon: string;
}

export interface MuseumKnowledgeSnapshot {
  source: 'mysql' | 'fallback';
  fetchedAt: number;
  collections: GroundedCollectionItem[];
  ticketCategories: GroundedTicketCategory[];
  operatingHours: GroundedOperatingHours;
  faqs: GroundedFaqItem[];
  announcements: GroundedAnnouncement[];
}

const FALLBACK_COLLECTIONS: GroundedCollectionItem[] = [
  {
    id: 1,
    kode: '#INV-MB-001',
    nama: 'Gerbong Maut',
    sub_deskripsi: 'Peninggalan Peristiwa 23 November 1947',
    deskripsi_lengkap:
      'Gerbong kereta api barang bernomor GR 10152 yang menjadi saksi bisu tragedi Peristiwa Gerbong Maut 23 November 1947. Sebanyak 100 pejuang kemerdekaan yang ditawan Belanda diangkut dalam kondisi tertutup rapat, panas, dan minim udara dari Bondowoso menuju Surabaya sehingga 46 pejuang gugur di perjalanan. Kini dipamerkan di Halaman Tengah Museum Brawijaya sebagai monumen pengingat pengorbanan pahlawan.',
    kategori: 'Kendaraan',
    tahun: '1947',
    lokasi: 'Halaman Tengah / Depan',
    status: 'DIPAMERKAN',
  },
  {
    id: 2,
    kode: '#INV-MB-002',
    nama: 'Senjata Katana Jepang',
    sub_deskripsi: 'Rampasan Tentara Jepang',
    deskripsi_lengkap:
      'Pedang katana peninggalan tentara Jepang yang berhasil dirampas oleh pejuang kemerdekaan Indonesia pada masa akhir pendudukan Jepang (1942-1945) dan digunakan dalam perjuangan mempertahankan kemerdekaan di Jawa Timur.',
    kategori: 'Senjata',
    tahun: '1942',
    lokasi: 'Gedung Utama (Ruang Pamer I)',
    status: 'DIPAMERKAN',
  },
  {
    id: 3,
    kode: '#INV-MB-003',
    nama: 'Dokumen Peta Strategi Perang',
    sub_deskripsi: 'Arsip Otentik Panglima',
    deskripsi_lengkap:
      'Dokumen taktik, peta operasi militer, dan denah pertahanan gerilya era perang kemerdekaan Indonesia yang digunakan pimpinan TNI Divisi Brawijaya dalam merencanakan strategi pertempuran di Jawa Timur.',
    kategori: 'Dokumen',
    tahun: '1945',
    lokasi: 'Ruang Pamer II / Arsip Khusus',
    status: 'DIPAMERKAN',
  },
  {
    id: 4,
    kode: '#INV-MB-004',
    nama: 'Meriam Si Buang / Artileri Pertahanan',
    sub_deskripsi: 'Artileri Berat Pertahanan',
    deskripsi_lengkap:
      'Meriam artileri berat yang digunakan dalam pertahanan wilayah Jawa Timur pada masa perjuangan kemerdekaan Indonesia. Menjadi salah satu koleksi ikonik di area luar museum.',
    kategori: 'Senjata',
    tahun: '1943',
    lokasi: 'Halaman Depan (Agne Yastra Loka)',
    status: 'DIPAMERKAN',
  },
  {
    id: 5,
    kode: '#INV-MB-005',
    nama: 'Seragam Dinas TNI Era Kemerdekaan',
    sub_deskripsi: 'Pakaian Otentik Perwira',
    deskripsi_lengkap:
      'Seragam dinas resmi perwira dan prajurit TNI Divisi Brawijaya era perang kemerdekaan hingga 1950-an beserta lencana dan atribut asli yang masih terawat dengan baik.',
    kategori: 'Pakaian',
    tahun: '1950',
    lokasi: 'Gedung Utama (Ruang Pamer II)',
    status: 'DIPAMERKAN',
  },
  {
    id: 6,
    kode: '#INV-MB-006',
    nama: 'Tank Amfibi',
    sub_deskripsi: 'Kendaraan Perang Darat-Air',
    deskripsi_lengkap:
      'Tank amfibi bersejarah yang mampu beroperasi di darat maupun perairan, digunakan dalam operasi militer mempertahankan kedaulatan wilayah Indonesia dan dipajang di area taman senjata Agne Yastra Loka.',
    kategori: 'Kendaraan',
    tahun: '1948',
    lokasi: 'Halaman Depan (Agne Yastra Loka)',
    status: 'DIPAMERKAN',
  },
  {
    id: 7,
    kode: '#INV-MB-007',
    nama: 'Perahu Segigir',
    sub_deskripsi: 'Armada Laut Perjuangan',
    deskripsi_lengkap:
      'Perahu tradisional yang digunakan oleh para pejuang untuk patroli pantai, penyamaran, dan pengiriman logistik serta amunisi melintasi jalur perairan Jawa Timur dan Selat Madura pada masa perjuangan 1946.',
    kategori: 'Kendaraan',
    tahun: '1946',
    lokasi: 'Halaman Tengah / Area Pameran Luar',
    status: 'DIPAMERKAN',
  },
  {
    id: 8,
    kode: '#INV-MB-008',
    nama: 'Mobil Dinas Letkol / Kolonel Sungkono',
    sub_deskripsi: 'Kendaraan Resmi Komandan',
    deskripsi_lengkap:
      'Mobil sedan DeSoto bersejarah yang digunakan sebagai kendaraan dinas komandan militer (Kolonel Sungkono, Panglima Divisi I/Jawa Timur) saat mengoordinasikan operasi pertahanan dan perjuangan kemerdekaan.',
    kategori: 'Kendaraan',
    tahun: '1948',
    lokasi: 'Gedung Utama (Ruang Pamer I)',
    status: 'DIPAMERKAN',
  },
  {
    id: 9,
    kode: '#INV-MB-009',
    nama: 'Patung Jenderal Sudirman',
    sub_deskripsi: 'Monumen Panglima Besar TNI',
    deskripsi_lengkap:
      'Patung Panglima Besar Jenderal Sudirman yang menyambut pengunjung sebagai simbol keteladanan kepemimpinan, semangat pantang menyerah, dan strategi perang gerilya TNI.',
    kategori: 'Monumen',
    tahun: '1968',
    lokasi: 'Area Lobby Utama',
    status: 'DIPAMERKAN',
  },
];

const FALLBACK_TICKET_CATEGORIES: GroundedTicketCategory[] = [
  { id: 1, badge: 'UMUM / DEWASA', title: 'Tiket Reguler (WNI Dewasa)', price: 10000, kuota: 500, status: 'Aktif' },
  { id: 2, badge: 'PELAJAR / MAHASISWA', title: 'Tiket Pelajar / Rombongan (WNI)', price: 5000, kuota: 300, status: 'Aktif' },
  { id: 3, badge: 'MANCANEGARA', title: 'Tiket Wisatawan Asing (WNA)', price: 25000, kuota: 100, status: 'Aktif' },
];

const FALLBACK_OPERATING_HOURS: GroundedOperatingHours = {
  hari: 'Selasa - Minggu (Senin Libur / Tutup)',
  jam: '08:00 - 15:00 WIB',
  telepon: '(0341) 551502',
};

const FALLBACK_FAQS: GroundedFaqItem[] = [
  {
    id: 1,
    question: 'Apakah harus membeli tiket secara online terlebih dahulu?',
    answer: 'Pengunjung dapat memesan e-tiket secara online langsung melalui menu Tiket di aplikasi ini maupun membeli langsung (OTS) di loket museum.',
  },
  {
    id: 2,
    question: 'Apakah diperbolehkan membawa kamera ke dalam area museum?',
    answer: 'Diperbolehkan mengambil foto untuk dokumentasi pribadi, dengan syarat tidak menggunakan lampu kilat (flash) pada koleksi dokumen atau benda bersejarah yang sensitif cahaya.',
  },
  {
    id: 3,
    question: 'Berapa lama waktu kunjungan yang direkomendasikan?',
    answer: 'Waktu kunjungan ideal adalah 1 hingga 2 jam agar bisa menikmati seluruh area halaman depan, Ruang Pamer I, Halaman Tengah (Gerbong Maut), dan Ruang Pamer II secara optimal.',
  },
];

const CACHE_TTL_MS = 60_000;
let cachedSnapshot: MuseumKnowledgeSnapshot | null = null;

function formatRupiah(amount: number): string {
  return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
}

export async function getMuseumKnowledgeSnapshot(forceRefresh = false): Promise<MuseumKnowledgeSnapshot> {
  if (!forceRefresh && cachedSnapshot && Date.now() - cachedSnapshot.fetchedAt < CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  try {
    const [koleksiResult, ticketCategoriesRaw, operatingHoursRaw, faqsRaw, announcementsRaw] =
      await Promise.all([
        koleksiModel.findPaginated({ page: 1, limit: 100 }),
        tiketModel.getAllCategories(),
        informasiModel.getJamOperasional(),
        informasiModel.getAllFaq(),
        informasiModel.getAllPengumuman('AKTIF'),
      ]);

    const collections: GroundedCollectionItem[] = Array.isArray(koleksiResult?.items) && koleksiResult.items.length > 0
      ? koleksiResult.items.map((item: any) => ({
          id: Number(item.id) || 0,
          kode: String(item.kode || ''),
          nama: String(item.nama || ''),
          sub_deskripsi: String(item.sub_deskripsi || ''),
          deskripsi_lengkap: String(item.deskripsi_lengkap || item.sub_deskripsi || ''),
          kategori: String(item.kategori || 'Umum'),
          tahun: String(item.tahun || '-'),
          lokasi: String(item.lokasi || 'Area Pamer Museum Brawijaya'),
          status: String(item.status || 'DIPAMERKAN'),
        }))
      : FALLBACK_COLLECTIONS;

    const ticketCategories: GroundedTicketCategory[] =
      Array.isArray(ticketCategoriesRaw) && ticketCategoriesRaw.length > 0
        ? ticketCategoriesRaw
            .filter((t: any) => String(t.status || 'Aktif').toLowerCase() === 'aktif')
            .map((t: any) => ({
              id: Number(t.id) || 0,
              badge: String(t.badge || ''),
              title: String(t.title || ''),
              price: Number(t.price) || 0,
              kuota: Number(t.kuota) || 0,
              status: String(t.status || 'Aktif'),
            }))
        : FALLBACK_TICKET_CATEGORIES;

    const operatingHours: GroundedOperatingHours = operatingHoursRaw
      ? {
          hari: String(operatingHoursRaw.hari || FALLBACK_OPERATING_HOURS.hari),
          jam: String(operatingHoursRaw.jam || FALLBACK_OPERATING_HOURS.jam),
          telepon: String(operatingHoursRaw.telepon || FALLBACK_OPERATING_HOURS.telepon),
        }
      : FALLBACK_OPERATING_HOURS;

    const faqs: GroundedFaqItem[] = Array.isArray(faqsRaw) && faqsRaw.length > 0
      ? faqsRaw.map((f: any) => ({
          id: Number(f.id) || 0,
          question: String(f.question || ''),
          answer: String(f.answer || ''),
        }))
      : FALLBACK_FAQS;

    const announcements: GroundedAnnouncement[] = Array.isArray(announcementsRaw)
      ? announcementsRaw.slice(0, 5).map((a: any) => ({
          id: Number(a.id) || 0,
          title: String(a.title || ''),
          description: String(a.description || ''),
          category: String(a.category || ''),
          date: String(a.date || ''),
          status: String(a.status || 'AKTIF'),
        }))
      : [];

    cachedSnapshot = {
      source: 'mysql',
      fetchedAt: Date.now(),
      collections,
      ticketCategories: ticketCategories.length > 0 ? ticketCategories : FALLBACK_TICKET_CATEGORIES,
      operatingHours,
      faqs,
      announcements,
    };
    return cachedSnapshot;
  } catch {
    const fallback: MuseumKnowledgeSnapshot = {
      source: 'fallback',
      fetchedAt: Date.now(),
      collections: FALLBACK_COLLECTIONS,
      ticketCategories: FALLBACK_TICKET_CATEGORIES,
      operatingHours: FALLBACK_OPERATING_HOURS,
      faqs: FALLBACK_FAQS,
      announcements: [],
    };
    cachedSnapshot = fallback;
    return fallback;
  }
}

export function buildGroundedContextBlock(snapshot: MuseumKnowledgeSnapshot): string {
  const collectionLines = snapshot.collections
    .map((c) => {
      const desc = (c.deskripsi_lengkap || c.sub_deskripsi).replace(/\s+/g, ' ').slice(0, 260);
      return `- ${c.nama} (${c.kode}) | Kategori: ${c.kategori} | Era/Tahun: ${c.tahun || '-'} | Lokasi: ${c.lokasi || '-'} | Status: ${c.status}. Ringkasan: ${desc}`;
    })
    .join('\n');

  const ticketLines = snapshot.ticketCategories
    .map((t) => `- ${t.title} [${t.badge}]: ${formatRupiah(t.price)} (Kuota harian: ${t.kuota}, Status: ${t.status})`)
    .join('\n');

  const faqLines = snapshot.faqs
    .slice(0, 8)
    .map((f) => `- Q: ${f.question}\n  A: ${f.answer}`)
    .join('\n');

  const announcementLines = snapshot.announcements.length > 0
    ? snapshot.announcements
        .map((a) => `- [${a.category} - ${a.date}] ${a.title}: ${a.description}`)
        .join('\n')
    : '- Tidak ada pengumuman khusus tambahan saat ini.';

  return [
    '=== PROFIL RESMI MUSEUM BRAWIJAYA MALANG ===',
    '- Nama Resmi: Museum Brawijaya Malang (di bawah pengelolaan Bintaljarahdam V/Brawijaya).',
    '- Alamat: Jl. Besar Ijen No. 25A, Gading Kasri, Kec. Klojen, Kota Malang, Jawa Timur 65115.',
    '- Sejarah Singkat: Diprakarsai oleh Brigjen TNI (Purn.) Soerachman (Pangdam VIII/Brawijaya 1959-1962) pada 1962, dibangun mulai 1967, dan diresmikan pada 4 Mei 1968 oleh Kolonel Dr. Soewondo.',
    '- Motto: "Citra Uthapana Cakra" (Sinar yang Membangkitkan Semangat/Kekuatan).',
    '- Area Kunjungan: Halaman Depan (Agne Yastra Loka: tank & artileri), Lobby Utama (Patung Jenderal Sudirman & relief), Ruang Pamer I (koleksi perjuangan 1945-1949), Halaman Tengah (Gerbong Maut & Perahu Segigir), Ruang Pamer II (koleksi 1950-1976 & peta strategi), serta Perpustakaan Sejarah.',
    `- Jam Operasional: ${snapshot.operatingHours.hari}, pukul ${snapshot.operatingHours.jam}. Telepon: ${snapshot.operatingHours.telepon}.`,
    '- Sesi Kunjungan E-Tiket di Aplikasi: 08:00 - 10:00 WIB, 10:00 - 12:00 WIB, 13:00 - 15:00 WIB.',
    '',
    '=== HARGA & KATEGORI TIKET AKTUAL (DATABASE) ===',
    ticketLines,
    '',
    `=== DAFTAR KOLEKSI AKTUAL MUSEUM (${snapshot.collections.length} ITEM DARI DATABASE) ===`,
    collectionLines,
    '',
    '=== PENGUMUMAN AKTIF ===',
    announcementLines,
    '',
    '=== FAQ RESMI MUSEUM ===',
    faqLines,
  ].join('\n');
}

export function clearMuseumKnowledgeCache(): void {
  cachedSnapshot = null;
}
