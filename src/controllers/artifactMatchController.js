const { GoogleGenerativeAI } = require('@google/generative-ai');
const { query } = require('../database');

const quizOptions = [
  new Set([
    'Menjelajah alam bebas',
    'Menyusun strategi & taktik',
    'Mempelajari dokumen sejarah kuno',
    'Mengamati benda seni & simbolik',
  ]),
  new Set([
    'Tangguh & tak kenal menyerah',
    'Cekatan & solutif',
    'Tenang & penuh perhitungan',
    'Setia & berdedikasi tinggi',
  ]),
  new Set([
    'Pasukan di garis depan',
    'Pengatur taktik pertahanan',
    'Juru runding & arsiparis',
    'Penggerak semangat rakyat',
  ]),
];

function getValidatedAnswers(body) {
  if (!Array.isArray(body?.answers) || body.answers.length !== quizOptions.length) {
    return null;
  }

  const answers = body.answers.map((answer) => (
    typeof answer === 'string' ? answer.trim() : ''
  ));
  return answers.every((answer, index) => quizOptions[index].has(answer))
    ? answers
    : null;
}

async function createArtifactMatch(req, res) {
  const answers = getValidatedAnswers(req.body);
  if (!answers) {
    return res.status(400).json({
      success: false,
      message: 'Tiga jawaban kuis wajib diisi dengan pilihan yang valid.',
    });
  }

  let visitorName = null;
  if (req.body.visitor_name != null) {
    if (typeof req.body.visitor_name !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Nama pengunjung tidak valid.',
      });
    }
    const trimmedName = req.body.visitor_name.trim();
    if (trimmedName.length > 191) {
      return res.status(400).json({
        success: false,
        message: 'Nama pengunjung tidak valid.',
      });
    }
    visitorName = trimmedName || null;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      message: 'Layanan AI belum dikonfigurasi.',
    });
  }

  let artifacts;
  try {
    artifacts = await query(`
      SELECT id, nama, kategori, tahun,
        SUBSTRING(COALESCE(NULLIF(deskripsi_lengkap, ''), sub_deskripsi), 1, 320) AS deskripsi
      FROM koleksi
      WHERE nama IS NOT NULL
      ORDER BY id ASC
    `);
  } catch (error) {
    console.error('Gagal mengambil referensi koleksi untuk kuis artefak:', error);
    return res.status(500).json({
      success: false,
      message: 'Data koleksi museum tidak dapat dimuat.',
    });
  }

  if (!artifacts || artifacts.length === 0) {
    return res.status(503).json({
      success: false,
      message: 'Koleksi museum belum tersedia untuk pencocokan.',
    });
  }

  let matchedArtifact;
  let aiExplanation;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = [
      'Kamu adalah kurator edukasi Museum Brawijaya Malang. Cocokkan jawaban kuis pengunjung dengan satu artefak dari daftar koleksi museum berikut.',
      'Pilih hanya berdasarkan ID yang tersedia. Gunakan detail referensi untuk penjelasan historis; jangan mengarang fakta atau hubungan sejarah yang tidak didukung data.',
      'Buat penjelasan personal dalam bahasa Indonesia yang menarik, rapi, edukatif, sekitar 2-3 kalimat, tanpa Markdown.',
      'Balas hanya dengan JSON valid berisi matched_artifact_id (angka dari daftar) dan ai_explanation (string).',
      `Jawaban pengunjung: ${JSON.stringify(answers)}`,
      `Daftar koleksi museum: ${JSON.stringify(artifacts)}`,
    ].join('\n\n');

    const result = await model.generateContent(prompt);
    let rawText = result.response.text().trim();

    // --- PEMBERSIH TAMBAHAN AGAR AMAN DARI MARKDOWN ---
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      rawText = rawText.substring(jsonStart, jsonEnd + 1);
    }
    // --------------------------------------------------

    const parsed = JSON.parse(rawText);

    matchedArtifact = artifacts.find(
      (artifact) => String(artifact.id) === String(parsed.matched_artifact_id),
    );

    // Pengaman jika ID pilihan AI tidak ditemukan, gunakan artefak pertama secara otomatis
    if (!matchedArtifact && artifacts.length > 0) {
      matchedArtifact = artifacts[0];
    }

    aiExplanation = typeof parsed.ai_explanation === 'string'
      ? parsed.ai_explanation.trim()
      : 'Artefak ini memiliki nilai sejarah yang selaras dengan karakter pilihanmu.';

    if (!matchedArtifact || !aiExplanation) {
      throw new Error('Data hasil kecocokan kosong.');
    }
  } catch (error) {
    console.error('Gagal mencocokkan artefak dengan Gemini:', error);
    // Fallback otomatis agar pengunjung tidak pernah mendapati error merah
    matchedArtifact = artifacts[0];
    aiExplanation = 'Semangat juangmu sangat mencerminkan nilai historis dari koleksi unggulan Museum Brawijaya ini.';
  }

  try {
    const insertRes = await query(
      `INSERT INTO artifact_quiz_results
        (visitor_name, answers, matched_artifact, ai_explanation)
       VALUES (?, ?, ?, ?)`,
      [visitorName, JSON.stringify(answers), matchedArtifact.nama, aiExplanation],
    );

    const savedRows = await query(
      'SELECT created_at FROM artifact_quiz_results WHERE id = ?',
      [insertRes.insertId],
    );
    const createdAt = savedRows && savedRows.length > 0 ? savedRows[0].created_at : new Date();

    return res.status(201).json({
      matched_artifact: matchedArtifact.nama,
      ai_explanation: aiExplanation,
      created_at: createdAt,
    });
  } catch (error) {
    console.error('Gagal menyimpan hasil kuis kecocokan artefak:', error);
    return res.status(500).json({
      success: false,
      message: 'Hasil kecocokan tidak dapat disimpan.',
    });
  }
}

async function getArtifactMatches(req, res) {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 100))
    : 25;

  try {
    const totalResult = await query(
      'SELECT COUNT(*) AS total FROM artifact_quiz_results',
    );
    const totalCount = totalResult && totalResult[0] ? Number(totalResult[0].total) : 0;

    const matches = await query(
      `SELECT matched_artifact, COUNT(*) AS match_count
       FROM artifact_quiz_results
       GROUP BY matched_artifact
       ORDER BY match_count DESC, matched_artifact ASC
       LIMIT 10`,
    );

    const history = await query(
      `SELECT id, visitor_name, answers, matched_artifact, ai_explanation, created_at
       FROM artifact_quiz_results
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [limit],
    );

    return res.json({
      success: true,
      statistics: {
        total: totalCount,
        mostMatchedArtifacts: (matches || []).map((match) => ({
          matched_artifact: match.matched_artifact,
          match_count: Number(match.match_count),
        })),
      },
      data: (history || []).map((result) => ({
        ...result,
        answers: typeof result.answers === 'string' ? JSON.parse(result.answers) : result.answers,
      })),
    });
  } catch (error) {
    console.error('Gagal mengambil riwayat kecocokan artefak:', error);
    return res.status(500).json({
      success: false,
      message: 'Riwayat kecocokan artefak tidak dapat dimuat.',
    });
  }
}

module.exports = { createArtifactMatch, getArtifactMatches };