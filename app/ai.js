// מאיפה מגיעה "ההבנה"? שלוש אפשרויות, לפי הסדר:
//  1. 'server' – השרת שלנו (worker/) כשמוגדר API_URL ב-config.js. זה המוצר האמיתי.
//  2. 'claude' – כשהאתר פתוח כדף הדגמה בתוך Claude (claude.ai), Claude קורא ומתרגם
//                על חשבון המשתמש שצופה. מצוין לבדוק את איכות האמהרית לפני שמקימים שרת.
//  3. 'demo'   – תשובות לדוגמה קבועות. לבדיקת החוויה עם מבוגרים, בלי שום חיבור.

import { API_URL } from './config.js';
import {
  EXPLAIN_PROMPT, ASK_PROMPT, TRANSLATE_PROMPT, EXPLAIN_SCHEMA, ASK_SCHEMA, TRANSLATE_SCHEMA,
} from './prompts.js';
import { playUrl, tts as browserTts, stop as stopBrowser, hasBrowserVoice } from './voice.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

let backendPromise;
export function backend() {
  backendPromise ??= (async () => {
    if (API_URL) return { kind: 'server', typed: false };
    if (window.claude?.use) {
      try {
        const sample = await window.claude.use('sample');
        const limits = sample && await sample.limits().catch(() => null);
        if (sample && limits?.images) {
          const tts = await window.claude.use('tts').catch(() => null);
          return { kind: 'claude', sample, tts, typed: true }; // בדף ההדגמה אין מיקרופון
        }
      } catch { /* נמשיך להדגמה */ }
    }
    return { kind: 'demo', typed: false };
  })();
  return backendPromise;
}

// ---------- תשובות לדוגמה ----------
const DEMO_DOC = {
  demo: true, readable: true, document_type: 'invitation', sender: 'המרכז הקהילתי', event: 'מפגש לוותיקים',
  date: '2026-12-07', weekday_he: 'שני', time: '10:30', place: 'המרכז הקהילתי, רחוב הרצל 12', missing: [],
  action_he: 'אין צורך להירשם. הכניסה חופשית.', review_required: false, scam_warning: false,
  summary_am: 'ይህ ከማኅበረሰብ ማዕከሉ የመጣ ግብዣ ነው። ስብሰባው ሰኞ፣ ታኅሣሥ 7 በፈረንጆች አቆጣጠር፣ ከጠዋቱ አራት ሰዓት ተኩል ነው። መግቢያው ነፃ ነው።',
  summary_he: 'זו הזמנה מהמרכז הקהילתי. המפגש ביום שני, 7 בדצמבר, בשעה 10:30. הכניסה חופשית.',
};
const DEMO_BLURRY = {
  demo: true, readable: false, retake_hint: 'cut_off', document_type: 'unreadable', missing: [], review_required: false,
  scam_warning: false, summary_am: 'የወረቀቱ ታችኛው ክፍል አልገባም። ስልኩን ትንሽ ያርቁ።', summary_he: 'החלק התחתון של הדף לא נכנס. הרחיקו קצת את הטלפון.',
};
const DEMO_ANSWER = {
  demo: true, understood: true, question_he: 'איפה זה מתקיים?', review_required: false, scam_warning: false, emergency: false,
  answer_am: 'ስብሰባው በማኅበረሰብ ማዕከሉ፣ ሄርዝል መንገድ 12 ነው።', answer_he: 'המפגש במרכז הקהילתי, רחוב הרצל 12.',
};
const DEMO_TALK = [
  { speaker: 'user', heard_ok: true, original: 'መድኃኒት ልወስድ ነው የመጣሁት። ምን ማሳየት አለብኝ?', translation: 'באתי לקחת תרופה. מה אני צריך להציג?', needs_clarification: false, sensitive: false },
  { speaker: 'provider', heard_ok: true, original: 'צריך תעודת זהות או כרטיס קופת חולים. זה יעלה 500 שקל.', translation: 'የመታወቂያ ካርድ ወይም የጤና መድን ካርድ ያስፈልጋል። ዋጋው 500 ሼቅል ነው።', needs_clarification: false, sensitive: false, verify_hint_am: '500 ሼቅል ተብሏል። ደረሰኙን ፎቶ አንስተው ማረጋገጥ ይፈልጋሉ?' },
  { speaker: 'user', heard_ok: true, original: 'እሺ፣ ካርዱ ይኸው።', translation: 'בסדר, הנה הכרטיס.', needs_clarification: false, sensitive: false },
  { speaker: 'provider', heard_ok: true, original: 'תגיד לי בבקשה את הקוד שקיבלת עכשיו בהודעה.', translation: 'አሁን በመልዕክት የደረሰዎትን ኮድ ይንገሩኝ።', needs_clarification: false, sensitive: true, sensitive_note_am: 'ረዳትዎ ነው የሚናገረው። በመልዕክት የመጣ ኮድ ጠይቀዋል። እዚህ ማቆም እና ከሚያምኑት ሰው ጋር ማረጋገጥ ይችላሉ።' },
];
let demoTalkIndex = 0;

// ---------- עזרים ----------
const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

async function api(path, body) {
  const res = await fetch(API_URL.replace(/\/$/, '') + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('api ' + res.status);
  return res;
}

// הופך את הסכמה לרשימת שדות קריאה, בשביל Claude (שמקבל את הפורמט כטקסט)
function describeSchema(schema) {
  return Object.entries(schema.properties).map(([k, v]) => {
    const type = v.type === 'ARRAY' ? 'array of strings' : v.type.toLowerCase();
    const opt = v.nullable ? ' or null' : '';
    const en = v.enum ? ` (one of: ${v.enum.join(', ')})` : '';
    return `- "${k}": ${type}${opt}${en} — ${v.description || ''}`;
  }).join('\n');
}
const jsonInstruction = schema =>
  `\n\nReply with ONLY one JSON object with exactly these fields:\n${describeSchema(schema)}`;

/** הקשר של המסמך האחרון – לשאלות המשך */
export function docContext(doc) {
  if (!doc?.summary_he) return undefined;
  return Object.fromEntries(['document_type', 'event', 'date', 'weekday_he', 'time', 'place', 'sender', 'amount',
    'deadline', 'action_he', 'summary_he'].filter(k => doc[k]).map(k => [k, doc[k]]));
}

// ---------- מסמך ----------
let demoPhotos = 0;
export async function explainPhoto(blob) {
  const b = await backend();
  if (b.kind === 'server') return (await api('/api/explain', { image: await blobToBase64(blob), mime: 'image/jpeg' })).json();
  if (b.kind === 'claude') {
    const r = await b.sample.json(
      EXPLAIN_PROMPT + '\n\nThe attached image is the photo the person took.' + jsonInstruction(EXPLAIN_SCHEMA),
      { images: [blob], modelTier: 'default' });
    if (r.scam_warning) r.review_required = true;
    return { ...r, via: 'claude' };
  }
  await wait(1200);
  return demoPhotos++ === 0 ? DEMO_BLURRY : DEMO_DOC; // בהדגמה: הצילום הראשון "חתוך", כדי להראות את ההדרכה
}

/** question: Blob (הקלטת WAV) או מחרוזת (בדף ההדגמה, שבו אין מיקרופון) */
export async function ask(question, doc) {
  const b = await backend();
  const context = docContext(doc);
  if (b.kind === 'server') {
    return (await api('/api/ask', { audio: await blobToBase64(question), mime: 'audio/wav', context })).json();
  }
  if (b.kind === 'claude') {
    const ctx = context ? `\n\nThe person is asking about this document they photographed earlier:\n${JSON.stringify(context)}` : '';
    const r = await b.sample.json(
      ASK_PROMPT.replace('You get a short voice recording.', 'Instead of a recording, you get the question as typed text (demo).')
        + ctx + `\n\nThe question:\n"""${String(question).slice(0, 2000)}"""` + jsonInstruction(ASK_SCHEMA),
      { modelTier: 'default', cache: false });
    return { ...r, via: 'claude' };
  }
  await wait(1200);
  return DEMO_ANSWER;
}

// ---------- מתורגמן בשיחה ----------
/** speaker: 'user' (אמהרית) | 'provider' (עברית). input: Blob או טקסט מוקלד */
export async function translate(input, speaker, history) {
  const b = await backend();
  const hist = history.slice(-6).map(t => ({ speaker: t.speaker, original: t.original }));
  if (b.kind === 'server') {
    const r = await (await api('/api/translate', { audio: await blobToBase64(input), mime: 'audio/wav', speaker, history: hist })).json();
    return { ...r, speaker };
  }
  if (b.kind === 'claude') {
    const who = speaker === 'user'
      ? 'This utterance is from the USER (Amharic, or typed in any language). Translate it into Hebrew.'
      : 'This utterance is from the PROVIDER (Hebrew). Translate it into Amharic.';
    const ctx = hist.length ? '\n\nRecent conversation:\n' + hist.map(t => `${t.speaker}: ${t.original}`).join('\n') : '';
    const r = await b.sample.json(
      TRANSLATE_PROMPT + '\n\n(Demo: the utterance was typed instead of spoken.)\n' + who + ctx
        + `\n\nThe utterance:\n"""${String(input).slice(0, 2000)}"""` + jsonInstruction(TRANSLATE_SCHEMA),
      { modelTier: 'default', cache: false });
    return { ...r, speaker, via: 'claude' };
  }
  await wait(900);
  const next = DEMO_TALK.find((t, i) => i >= demoTalkIndex && t.speaker === speaker) ?? DEMO_TALK.find(t => t.speaker === speaker);
  demoTalkIndex = DEMO_TALK.indexOf(next) + 1;
  return { ...next, demo: true };
}

// ---------- קול ----------
const audioCache = new Map();

/**
 * להשמיע טקסט בשפה מסוימת.
 * item: { text, lang: 'am'|'he', signed? }  (signed = האישור מהשרת להקראה בקול טבעי)
 * מחזיר true אם הושמע.
 */
export async function speak(item, { rate = 1 } = {}) {
  if (!item?.text) return false;
  const b = await backend();
  const lang = item.lang || 'am';
  if (b.kind === 'server' && item.signed) {
    const key = `${lang}|${rate}|${item.text}`;
    try {
      if (!audioCache.has(key)) {
        const res = await api('/api/speak', { ...item.signed, rate: 0.88 * rate });
        audioCache.set(key, URL.createObjectURL(await res.blob()));
      }
      await playUrl(audioCache.get(key));
      return true;
    } catch { /* נמשיך לגיבוי */ }
  }
  if (b.kind === 'claude' && b.tts) {
    try {
      await b.tts.speak(item.text, { language: lang, rate: 0.9 * rate });
      return true;
    } catch (e) {
      if (e?.code === 'not_granted') return false; // הצופה כיבה הקראה – לא עוקפים בקול אחר
      if (e?.code === 'stopped') return true;
    }
  }
  if (lang === 'am' && !hasBrowserVoice('am')) return false; // אין קול אמהרי במכשיר – שהמסך יחליט מה להשמיע
  return browserTts(item.text, lang, 0.85 * rate);
}

/** האם יש קול "חיצוני" (שרת / Claude) שיכול להקריא אמהרית של משפטים קבועים */
export async function speakFixedAm(text) {
  const b = await backend();
  if (b.kind !== 'claude' || !b.tts) return false;
  try { await b.tts.speak(text, { language: 'am', rate: 0.9 }); return true; } catch { return false; }
}

export async function stopSpeaking() {
  stopBrowser();
  const b = await backend();
  b.tts?.stop?.().catch(() => {});
}
