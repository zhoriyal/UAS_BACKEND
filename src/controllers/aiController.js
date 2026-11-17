const { GoogleGenerativeAI } = require('@google/generative-ai');

async function generateDescription(req, res) {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';

  if (!title) {
    return res.status(400).json({ message: 'Nama koleksi wajib diisi' });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ message: 'Layanan AI belum dikonfigurasi' });
  }

  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: 'gemini-3.8-flash',
    });
    const prompt = [
      'Tuliskan deskripsi sejarah koleksi Museum Brawijaya Malang dalam bahasa Indonesia yang formal, edukatif, dan menarik.',
      'Buat 2-3 paragraf ringkas tanpa judul, daftar, atau format Markdown berlebihan.',
      'Gunakan informasi yang dapat dipastikan dari nama dan kategori koleksi; jangan mengarang tahun, peristiwa, asal-usul, atau fakta spesifik yang tidak diketahui.',
      `Nama koleksi: ${title}`,
      `Kategori: ${category || 'Tidak disebutkan'}`,
    ].join('\n');
    const result = await model.generateContent(prompt);
    const description = result.response.text().trim();

    if (!description) {
      console.error('Gemini menghasilkan deskripsi kosong untuk koleksi:', title);
      return res.status(502).json({ message: 'AI tidak menghasilkan deskripsi. Silakan coba lagi.' });
    }

    return res.json({ description });
  } catch (error) {
    console.error('Gagal menghasilkan deskripsi koleksi dengan Gemini:', error);
    return res.status(502).json({ message: 'Gagal menghasilkan deskripsi. Silakan coba lagi.' });
  }
}

module.exports = { generateDescription };
