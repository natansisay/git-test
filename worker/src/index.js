// שרת קטן (Cloudflare Worker, שכבה חינמית) שמחזיק את המפתחות של שירותי ה-AI.
//
//  POST /api/explain  {image: base64, mime}            -> הסבר מובנה למסמך (עובדות + טקסט באמהרית ובעברית)
//  POST /api/ask      {audio: base64, mime, context?}  -> תשובה לשאלה קולית
//  POST /api/translate {audio, mime, speaker, history} -> תרגום בשיחה (user=אמהרית→עברית, provider=עברית→אמהרית)
//  POST /api/speak    {text, lang, token, rate?}       -> קובץ MP3 באמהרית/עברית (רק לטקסט שהשרת עצמו יצר)
//
// שום תמונה או הקלטה לא נשמרת כאן. הכול מעובד בזיכרון ונשכח.
// ספקים: Gemini (קריאת המסמך + הבנה + תרגום) ו-Azure Speech (קול אמהרי). לשניהם יש שכבה חינמית.

const DEFAULT_MODEL = 'gemini-2.5-flash';   // לעדכן למודל Flash העדכני (משתנה GEMINI_MODEL)
const MAX_UPLOAD = 8 * 1024 * 1024;

import { EXPLAIN_PROMPT, ASK_PROMPT, TRANSLATE_PROMPT, EXPLAIN_SCHEMA, ASK_SCHEMA, TRANSLATE_SCHEMA } from '../../app/prompts.js';

// ---------- ספקים ----------
async function gemini(env, prompt, media, schema, extraText) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const parts = [{ inline_data: { mime_type: media.mime, data: media.data } }];
  if (extraText) parts.push({ text: extraText });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  if (!res.ok) throw new HttpError(502, `gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
  if (!text) throw new HttpError(502, 'gemini returned no content');
  return JSON.parse(text);
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

const VOICES = {
  am: env => ['am-ET', env.AZURE_VOICE || 'am-ET-MekdesNeural'], // קול נשי; גברי: am-ET-AmehaNeural
  he: env => ['he-IL', env.AZURE_VOICE_HE || 'he-IL-HilaNeural'],
};

async function azureTts(env, text, lang = 'am', rate = 0.88) {
  const [xmlLang, voice] = VOICES[lang](env);
  const pct = Math.round((Math.min(1.2, Math.max(0.6, rate)) - 1) * 100);
  const ssml = `<speak version="1.0" xml:lang="${xmlLang}"><voice name="${voice}"><prosody rate="${pct}%">${escapeXml(text)}</prosody></voice></speak>`;
  return fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'erdata-worker',
    },
    body: ssml,
  });
}

// ---------- חתימה: /api/speak מקריא רק טקסט שהשרת הזה יצר (שלא ינצלו את המכסה החינמית) ----------
async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const canSpeak = env => Boolean(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION && env.SIGNING_SECRET);
const speakable = async (env, text, lang) =>
  canSpeak(env) && text ? { text, lang, token: await sign(env, lang + '|' + text) } : null;

async function withVoice(env, result, field) {
  return { ...result, speak: await speakable(env, result[field], 'am') };
}

// ---------- HTTP ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });

async function readJson(req) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_UPLOAD) throw new HttpError(413, 'too large');
  try { return await req.json(); } catch { throw new HttpError(400, 'bad json'); }
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AUDIO_TYPES = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/flac'];

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const { pathname } = new URL(req.url);
    if (req.method === 'GET' && pathname === '/') return json({ ok: true }, 200, h);
    if (req.method !== 'POST') return json({ error: 'method' }, 405, h);

    try {
      if (pathname === '/api/explain') {
        const { image, mime = 'image/jpeg' } = await readJson(req);
        if (!image || !IMAGE_TYPES.includes(mime)) throw new HttpError(400, 'image required');
        const r = await gemini(env, EXPLAIN_PROMPT, { mime, data: image }, EXPLAIN_SCHEMA);
        if (r.scam_warning) r.review_required = true;
        return json(await withVoice(env, r, 'summary_am'), 200, h);
      }

      if (pathname === '/api/ask') {
        const { audio, mime = 'audio/wav', context } = await readJson(req);
        if (!audio || !AUDIO_TYPES.includes(mime)) throw new HttpError(400, 'audio required');
        const extra = context
          ? `The person is asking about this document they photographed earlier (facts extracted from it):\n${JSON.stringify(context).slice(0, 4000)}`
          : undefined;
        const r = await gemini(env, ASK_PROMPT, { mime, data: audio }, ASK_SCHEMA, extra);
        return json(await withVoice(env, r, 'answer_am'), 200, h);
      }

      if (pathname === '/api/translate') {
        const { audio, mime = 'audio/wav', speaker, history = [] } = await readJson(req);
        if (!audio || !AUDIO_TYPES.includes(mime) || !['user', 'provider'].includes(speaker)) throw new HttpError(400, 'bad input');
        const who = speaker === 'user'
          ? 'This utterance is from the USER, in Amharic. Translate it into Hebrew.'
          : 'This utterance is from the PROVIDER, in Hebrew. Translate it into Amharic.';
        const ctx = history.slice(-6).map(t => `${t.speaker}: ${String(t.original).slice(0, 300)}`).join('\n');
        const r = await gemini(env, TRANSLATE_PROMPT, { mime, data: audio }, TRANSLATE_SCHEMA,
          `${who}${ctx ? '\n\nRecent conversation:\n' + ctx : ''}`);
        const [own, other] = speaker === 'user' ? ['am', 'he'] : ['he', 'am'];
        return json({
          ...r,
          speak: {
            translation: await speakable(env, r.translation, other),
            clarify: await speakable(env, r.clarify_question, own),
            sensitive: await speakable(env, r.sensitive_note_am, 'am'),
            verify: await speakable(env, r.verify_hint_am, 'am'),
          },
        }, 200, h);
      }

      if (pathname === '/api/speak') {
        const { text, lang = 'am', token, rate } = await readJson(req);
        if (typeof text !== 'string' || text.length > 2000 || !VOICES[lang] || !token
            || token !== (await sign(env, lang + '|' + text))) {
          throw new HttpError(403, 'bad token');
        }
        const res = await azureTts(env, text, lang, Number(rate) || undefined);
        if (!res.ok) throw new HttpError(502, `tts ${res.status}`);
        return new Response(res.body, {
          headers: { ...h, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' },
        });
      }

      return json({ error: 'not found' }, 404, h);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      console.error(status, e.message); // בלי תוכן של משתמשים בלוג
      return json({ error: status >= 500 ? 'server' : e.message }, status, h);
    }
  },
};
