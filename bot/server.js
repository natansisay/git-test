// בוט וואטסאפ "גשר" – מחבר בין מבוגרים שלא קוראים לבין מתנדבים שמדברים אמהרית.
//
// איך זה עובד:
//  • המבוגר שולח לבוט כל דבר (הודעה קולית, תמונה של מכתב, "שלום") – כמו לנכד.
//  • הבוט עונה בהודעה *קולית* באמהרית + תמונת תפריט עם מספרים ואייקונים.
//  • כל הודעה קולית / תמונה מהמבוגר מועברת אוטומטית למתנדבים.
//  • המתנדב שולח לבוט את מספר הטלפון של המבוגר, ומשם כל מה שהוא שולח (קול/טקסט/תמונה)
//    עובר אליו – בלי שהמבוגר צריך לשמור מספרים חדשים.
//
// Node.js 18+ בלי חבילות חיצוניות. משתמש ב-WhatsApp Cloud API הרשמי של Meta.

import http from 'node:http';
import crypto from 'node:crypto';

const {
  PORT = 3000,
  WA_TOKEN,                 // Access token (System User token קבוע)
  PHONE_NUMBER_ID,          // מזהה מספר הטלפון של הבוט
  VERIFY_TOKEN,             // מחרוזת סודית שתבחרו – גם בהגדרות ה-Webhook ב-Meta
  APP_SECRET,               // לאימות שההודעות באמת מגיעות מ-Meta (מומלץ)
  HELPERS = '',             // מספרי המתנדבים, מופרדים בפסיק: 972501234567,972521234567
  MEDIA_BASE_URL = '',      // כתובת קבצי השמע, למשל https://USER.github.io/REPO/audio/am
  GRAPH_VERSION = 'v23.0',  // לעדכן לגרסה העדכנית של Graph API
} = process.env;

const helpers = HELPERS.split(',').map(s => s.trim()).filter(Boolean);
const helperTarget = new Map(); // מתנדב -> מספר המבוגר שהוא עונה לו כרגע
const API = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ---------- שליחה ----------
async function graph(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('WhatsApp API error', res.status, await res.text());
  return res.ok ? res.json() : undefined;
}

const send = (to, type, payload) =>
  graph(`${PHONE_NUMBER_ID}/messages`, { messaging_product: 'whatsapp', to, type, [type]: payload });

const sendText = (to, body) => send(to, 'text', { body });
const sendAudio = (to, name) => MEDIA_BASE_URL && send(to, 'audio', { link: `${MEDIA_BASE_URL}/${name}.mp3` });
const sendImage = (to, name, caption) => MEDIA_BASE_URL && send(to, 'image', { link: `${MEDIA_BASE_URL}/${name}.png`, caption });

// מוריד מדיה שהתקבלה ומעלה אותה מחדש כדי להעביר אותה הלאה
async function reupload(mediaId, mime) {
  const meta = await (await fetch(`${API}/${mediaId}`, { headers: { Authorization: `Bearer ${WA_TOKEN}` } })).json();
  const file = await (await fetch(meta.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } })).blob();
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([file], { type: mime }), 'file');
  const up = await fetch(`${API}/${PHONE_NUMBER_ID}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}` }, body: form,
  });
  return (await up.json()).id;
}

async function forward(msg, to, caption) {
  const kind = msg.type; // audio | image | video | document | text
  if (kind === 'text') return sendText(to, caption ? `${caption}\n${msg.text.body}` : msg.text.body);
  const media = msg[kind];
  if (!media?.id) return;
  if (caption) await sendText(to, caption);
  const id = await reupload(media.id, media.mime_type.split(';')[0]);
  return send(to, kind, { id });
}

// ---------- הלוגיקה ----------
const MENU = {
  '1': 'menu-helper',     // 🗣️ לדבר עם מתנדב
  '2': 'menu-lessons',    // 🎓 שיעורים קוליים
  '3': 'menu-emergency',  // 🚑 מספרי חירום
};
const EMOJI_DIGITS = { '1️⃣': '1', '2️⃣': '2', '3️⃣': '3', '🗣': '1', '🎓': '2', '🚑': '3' };

function choice(text) {
  const t = (text || '').trim();
  for (const [e, d] of Object.entries(EMOJI_DIGITS)) if (t.startsWith(e)) return d;
  const m = t.match(/^[1-3]$/);
  return m?.[0];
}

async function sendMenu(to) {
  await sendImage(to, 'menu', '1️⃣ 🗣️   2️⃣ 🎓   3️⃣ 🚑');
  await sendAudio(to, 'menu'); // "ሰላም! ለመናገር የድምፅ መልዕክት ይላኩ ..."
  if (!MEDIA_BASE_URL) await sendText(to, '1️⃣ 🗣️\n2️⃣ 🎓\n3️⃣ 🚑');
}

async function fromElder(msg) {
  const from = msg.from;
  if (msg.type === 'text' || msg.type === 'interactive') {
    const c = choice(msg.text?.body);
    if (!c) return sendMenu(from);
    if (c === '3') {
      await sendAudio(from, MENU[c]);
      return sendText(from, '🚑 101\n👮 100\n🚒 102');
    }
    return sendAudio(from, MENU[c]);
  }
  // הודעה קולית / תמונה / מסמך -> למתנדבים
  if (!helpers.length) return sendText(from, '⏳');
  const name = msg._contactName ? ` (${msg._contactName})` : '';
  for (const h of helpers) {
    await forward(msg, h, `📩 +${from}${name}\nלענות: שלחו לי את המספר ${from} ואז את התשובה`);
  }
  await sendAudio(from, 'received'); // "ተቀብለናል። በቅርቡ እንመልሳለን"
  return sendText(from, '✅');
}

async function fromHelper(msg) {
  const h = msg.from;
  const digits = msg.type === 'text' ? msg.text.body.replace(/[\s\-+]/g, '') : '';
  if (/^\d{9,15}$/.test(digits)) {
    const target = digits.startsWith('0') ? '972' + digits.slice(1) : digits;
    helperTarget.set(h, target);
    return sendText(h, `👍 מעכשיו מה שתשלחו יעבור ל-+${target}. לסיום שלחו: סיום`);
  }
  if (msg.type === 'text' && /^(סיום|stop|end)$/i.test(msg.text.body.trim())) {
    helperTarget.delete(h);
    return sendText(h, '👋 סיימנו. שלחו מספר כדי לענות למישהו אחר.');
  }
  const target = helperTarget.get(h);
  if (!target) return sendText(h, 'שלחו קודם את מספר הטלפון של מי שאתם עונים לו.');
  await forward(msg, target);
  return sendText(h, '✔️ הועבר');
}

async function handle(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return; // אישורי מסירה וכו'
  msg._contactName = value.contacts?.[0]?.profile?.name;
  return helpers.includes(msg.from) ? fromHelper(msg) : fromElder(msg);
}

// ---------- שרת ה-Webhook ----------
function validSignature(raw, header) {
  if (!APP_SECRET) return true;
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  return expected.length === header.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') return res.end('ok');
  if (url.pathname !== '/webhook') { res.statusCode = 404; return res.end(); }

  if (req.method === 'GET') { // אימות ראשוני מול Meta
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === VERIFY_TOKEN;
    res.statusCode = ok ? 200 : 403;
    return res.end(ok ? url.searchParams.get('hub.challenge') : '');
  }

  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    if (!validSignature(raw, req.headers['x-hub-signature-256'])) { res.statusCode = 401; return res.end(); }
    res.end('ok'); // עונים מיד ל-Meta, מטפלים אחר כך
    try { await handle(JSON.parse(raw)); } catch (e) { console.error('handle failed:', e.message); }
    return;
  }
  res.statusCode = 405; res.end();
});

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!WA_TOKEN || !PHONE_NUMBER_ID || !VERIFY_TOKEN) console.warn('⚠️ חסרים WA_TOKEN / PHONE_NUMBER_ID / VERIFY_TOKEN');
  server.listen(PORT, () => console.log(`bot listening on :${PORT}`));
}
