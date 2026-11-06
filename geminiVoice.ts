import { Buffer } from 'node:buffer';

const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts'; // fixed voice: Sulafat
const GEMINI_TTS_VOICE = 'Sulafat';
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const REQUEST_TIMEOUT_MS = 20_000;

interface CacheEntry {
  buffer: Buffer;
  expiresAt: number;
}

interface InlineAudio {
  mimeType: string;
  data: string;
}

const cache = new Map<string, CacheEntry>();

export function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY ?? '').trim();
}

export function normalizeAnnouncementText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function parsePcmRate(mimeType: string): number {
  const match = /rate=(\d+)/.exec(mimeType);
  const rate = match ? Number.parseInt(match[1] ?? '', 10) : NaN;
  return Number.isFinite(rate) && rate >= 8_000 && rate <= 96_000 ? rate : 24_000;
}

function extractInlineAudio(payload: unknown): InlineAudio {
  const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> })
    .candidates?.[0]?.content?.parts;
  const inline = parts?.find((part) => typeof part?.inlineData?.data === 'string' && part.inlineData.data.length > 0)
    ?.inlineData;
  if (!inline || !inline.data) {
    throw new Error('Gemini TTS response did not contain audio data.');
  }
  return { mimeType: stringOrEmpty(inline.mimeType), data: inline.data };
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export interface SynthesizeResult {
  buffer: Buffer;
  cacheHit: boolean;
}

export async function synthesizeAnnouncement(text: string): Promise<SynthesizeResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

  const now = Date.now();
  const cached = cache.get(text);
  if (cached) {
    if (cached.expiresAt > now) {
      return { buffer: cached.buffer, cacheHit: true };
    }
    cache.delete(text);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Say in a calm, quick trader-alert tone: ${text}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE },
              },
            },
          },
        }),
      }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gemini TTS HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const payload: unknown = await response.json();
  const inline = extractInlineAudio(payload);
  const pcm = Buffer.from(inline.data, 'base64');
  if (pcm.length === 0) throw new Error('Gemini TTS returned empty audio.');

  const wav = pcmToWav(pcm, parsePcmRate(inline.mimeType), 1);

  cache.set(text, { buffer: wav, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(String(oldest.value));
  }

  return { buffer: wav, cacheHit: false };
}
