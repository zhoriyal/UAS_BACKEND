import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Request, Response } from 'express';
import {
  DEFAULT_PROMPT_STARTERS,
  generateMuseumAiReply,
  isGeminiConfigured,
  type ChatHistoryMessage,
  type ChatImageAttachment,
} from '../lib/museumAiEngine';

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_IMAGE_PROMPT =
  'Tolong identifikasi dan jelaskan gambar ini dalam konteks Museum Brawijaya Malang.';

function parseImageAttachment(
  rawImage: unknown,
): { image?: ChatImageAttachment; error?: string } {
  if (rawImage === undefined || rawImage === null) {
    return {};
  }
  if (typeof rawImage !== 'object') {
    return { error: 'Format lampiran gambar tidak valid.' };
  }

  const candidate = rawImage as Record<string, unknown>;
  const rawBase64 = typeof candidate.base64 === 'string' ? candidate.base64.trim() : '';
  const rawMime = typeof candidate.mimeType === 'string'
    ? candidate.mimeType.trim().toLowerCase()
    : '';
  const rawFileName = typeof candidate.fileName === 'string'
    ? candidate.fileName.trim().slice(0, 120)
    : undefined;

  if (!rawBase64) {
    return { error: 'Data gambar tidak boleh kosong.' };
  }

  let base64Body = rawBase64;
  let detectedMime = rawMime;

  const dataUriMatch = rawBase64.match(/^data:([^;]+);base64,(.+)$/is);
  if (dataUriMatch) {
    detectedMime = detectedMime || dataUriMatch[1].trim().toLowerCase();
    base64Body = dataUriMatch[2];
  }

  base64Body = base64Body.replace(/\s+/g, '');
  if (detectedMime === 'image/jpg') {
    detectedMime = 'image/jpeg';
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(detectedMime)) {
    return { error: 'Format gambar harus JPG, PNG, WEBP, atau GIF.' };
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Body)) {
    return { error: 'Encoding gambar base64 tidak valid.' };
  }

  const estimatedBytes = Buffer.byteLength(base64Body, 'base64');
  if (estimatedBytes <= 0) {
    return { error: 'Gambar yang diunggah kosong.' };
  }
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    return { error: 'Ukuran gambar maksimal 5 MB.' };
  }

  return {
    image: {
      base64: base64Body,
      mimeType: detectedMime,
      fileName: rawFileName || undefined,
    },
  };
}

export async function generateDescription(req: Request, res: Response) {
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
      model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
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

export function getChatSuggestions(_req: Request, res: Response) {
  return res.json({
    success: true,
    data: {
      mode: isGeminiConfigured() ? 'gemini' : 'local_fallback',
      starters: DEFAULT_PROMPT_STARTERS,
      suggestions: DEFAULT_PROMPT_STARTERS,
    },
  });
}

export async function chatWithAssistant(req: Request, res: Response) {
  const rawMessages = req.body?.messages;
  const singleMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const { image, error: imageError } = parseImageAttachment(req.body?.image);

  if (imageError) {
    return res.status(400).json({
      success: false,
      message: imageError,
    });
  }

  const parsedMessages: ChatHistoryMessage[] = [];

  if (Array.isArray(rawMessages)) {
    for (const item of rawMessages) {
      if (!item || typeof item !== 'object') continue;
      const rawRole = typeof item.role === 'string' ? item.role.trim().toLowerCase() : '';
      const rawContent = typeof item.content === 'string' ? item.content.trim() : '';
      if (!rawContent) continue;

      const role: 'user' | 'assistant' =
        rawRole === 'assistant' || rawRole === 'model' ? 'assistant' : 'user';

      parsedMessages.push({
        role,
        content: rawContent.slice(0, 2000),
      });
    }
  } else if (singleMessage) {
    parsedMessages.push({
      role: 'user',
      content: singleMessage.slice(0, 2000),
    });
  }

  // Jika pengguna mengirim gambar tanpa teks, tambahkan prompt default otomatis
  if (image && (parsedMessages.length === 0 || parsedMessages[parsedMessages.length - 1].role !== 'user')) {
    parsedMessages.push({
      role: 'user',
      content: DEFAULT_IMAGE_PROMPT,
    });
  }

  if (parsedMessages.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Pesan percakapan atau gambar wajib diisi.',
    });
  }

  if (parsedMessages[parsedMessages.length - 1].role !== 'user') {
    return res.status(400).json({
      success: false,
      message: 'Pesan terakhir dalam percakapan harus berasal dari pengguna.',
    });
  }

  const visitorName = typeof req.body?.visitorName === 'string'
    ? req.body.visitorName.trim().slice(0, 100)
    : undefined;

  try {
    const result = await generateMuseumAiReply({
      messages: parsedMessages,
      visitorName,
      image,
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[AI CHAT] Kesalahan tak terduga:', error);
    return res.status(500).json({
      success: false,
      message: 'Asisten AI sedang mengalami kendala. Silakan coba lagi sebentar.',
    });
  }
}

export default { generateDescription, chatWithAssistant, getChatSuggestions };
