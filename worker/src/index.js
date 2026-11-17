// שרת קטן (Cloudflare Worker, שכבה חינמית) שמחזיק את המפתחות של שירותי ה-AI.
//
//  POST /api/explain  {image: base64, mime}            -> הסבר מובנה למסמך (עובדות + טקסט באמהרית ובעברית)
//  POST /api/ask      {audio: base64, mime, context?}  -> תשובה לשאלה קולית
//  POST /api/speak    {text, token}                    -> קובץ MP3 באמהרית (רק לטקסט שהשרת עצמו יצר)
//
// שום תמונה או הקלטה לא נשמרת כאן. הכול מעובד בזיכרון ונשכח.
// ספקים: Gemini (קריאת המסמך + הבנה + תרגום) ו-Azure Speech (קול אמהרי). לשניהם יש שכבה חינמית.

const DEFAULT_MODEL = 'gemini-2.5-flash';   // לעדכן למודל Flash העדכני (משתנה GEMINI_MODEL)
const MAX_UPLOAD = 8 * 1024 * 1024;

// ---------- הנחיות למודל ----------
const CORE_RULES = `
You help elderly Ethiopian-Israelis who cannot read or write (not Hebrew, often not Amharic either).
Everything you write in *_am fields will be READ ALOUD by a text-to-speech voice in Amharic.

Rules:
- Use ONLY information that is actually present. Never guess or invent dates, times, places, amounts or names.
  If something is missing or unclear, say so plainly and list it in "missing".
- Amharic: short sentences, everyday spoken words, warm and respectful (use the polite form እርስዎ). No bullet points, no symbols, no URLs.
  Keep it under about 60 words. Most important thing first: what is this, and what must the person do.
- Dates: say the Gregorian day, month name and weekday, and say it is "በፈረንጆች አቆጣጠር" so it is not confused with the Ethiopian calendar.
- Times: say the time the way Ethiopians tell time (Israeli clock minus 6 hours, with the part of day, e.g. 19:30 -> "ከምሽቱ አንድ ሰዓት ተኩል"),
  and also put the Israeli clock time in the Hebrew text.
- Never give medical dosing, legal or financial advice. For anything about medicine doses, courts, police, debts, fines,
  cutting benefits, or signing — set review_required=true and tell the person kindly to check it with a family member or helper.
- If the content asks for a password, a code sent by SMS, card details, or urgent payment through a link — set scam_warning=true
  and tell the person not to pay or give any code before a trusted person checks it.
- The *_he fields are for a family member or volunteer: simple, clear Hebrew.`;

const EXPLAIN_PROMPT = `${CORE_RULES}

You get a photo of a document (usually Hebrew: letters from Bituach Leumi, municipality, health fund (kupat holim),
appointment notices, bills, wedding/event invitations).
First decide if the photo is readable. If the text is cut off, blurry or too dark, set readable=false and in summary_am
ask kindly to take the photo again: the whole page, with good light, phone held still.`;

const ASK_PROMPT = `${CORE_RULES}

You get a short voice recording. The person speaks Amharic, possibly mixed with Hebrew words.
Understand the question and answer it briefly in Amharic.
- You have NO access to any personal records (health fund, Bituach Leumi, bank). Never pretend you do.
  If the answer depends on a letter or message, ask them to photograph it with the camera button.
- If it sounds like an emergency (pain, fall, fire, danger), tell them to call 101 now (ambulance) and set emergency=true.
- If you could not understand the recording, set understood=false and kindly ask them to speak again, slowly and close to the phone.`;

const S = (description, extra = {}) => ({ type: 'STRING', description, ...extra });
const B = description => ({ type: 'BOOLEAN', description });

const EXPLAIN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    readable: B('false if the photo is not clear enough to read reliably'),
    document_type: S('kind of document', {
      enum: ['invitation', 'appointment', 'letter', 'bill', 'medical', 'legal', 'advertisement', 'other', 'unreadable'],
    }),
    sender: S('who sent it, as written', { nullable: true }),
    event: S('what the event/appointment is, in Hebrew', { nullable: true }),
    date: S('date as YYYY-MM-DD, only if written', { nullable: true }),
    weekday_he: S('weekday in Hebrew, only if a date is written', { nullable: true }),
    time: S('time HH:MM 24h (Israeli clock), only if written', { nullable: true }),
    place: S('place/address as written', { nullable: true }),
    amount: S('money amount with currency, only if written', { nullable: true }),
    deadline: S('deadline date YYYY-MM-DD, only if written', { nullable: true }),
    action_he: S('what the person must do, short Hebrew, or null if nothing', { nullable: true }),
    missing: { type: 'ARRAY', items: { type: 'STRING' }, description: 'important details that are missing or unclear' },
    review_required: B('true if a human must check this before the person acts'),
    scam_warning: B('true if it looks like a scam or phishing'),
    summary_am: S('spoken Amharic explanation (max ~60 words)'),
    summary_he: S('the same explanation in simple Hebrew'),
  },
  required: ['readable', 'document_type', 'review_required', 'scam_warning', 'summary_am', 'summary_he', 'missing'],
};

const ASK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    understood: B('false if the recording could not be understood'),
    question_he: S('the question, translated to Hebrew'),
    answer_am: S('spoken Amharic answer (max ~60 words)'),
    answer_he: S('the same answer in simple Hebrew'),
    review_required: B('true if a human should help with this'),
    scam_warning: B('true if the person describes something that looks like a scam'),
    emergency: B('true if this sounds like an emergency'),
  },
  required: ['understood', 'answer_am', 'answer_he', 'review_required', 'scam_warning', 'emergency'],
};

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

async function azureTts(env, text) {
  const voice = env.AZURE_VOICE || 'am-ET-MekdesNeural'; // קול נשי; גברי: am-ET-AmehaNeural
  const ssml = `<speak version="1.0" xml:lang="am-ET"><voice name="${voice}"><prosody rate="-12%">${escapeXml(text)}</prosody></voice></speak>`;
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

async function withVoice(env, result, field) {
  const text = result[field];
  const canSpeak = Boolean(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION && env.SIGNING_SECRET && text);
  return { ...result, speak: canSpeak ? { text, token: await sign(env, text) } : null };
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

      if (pathname === '/api/speak') {
        const { text, token } = await readJson(req);
        if (typeof text !== 'string' || text.length > 2000 || !token || token !== (await sign(env, text))) {
          throw new HttpError(403, 'bad token');
        }
        const res = await azureTts(env, text);
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
