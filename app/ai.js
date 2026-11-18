// מאיפה מגיעה "ההבנה"? שלוש אפשרויות, לפי הסדר:
//  1. 'server' – השרת שלנו (worker/) כשמוגדר API_URL ב-config.js. זה המוצר האמיתי.
//  2. 'claude' – כשהאתר פתוח כדף הדגמה בתוך Claude (claude.ai), Claude קורא את המסמך
//                על חשבון המשתמש שצופה. מצוין לבדוק את איכות האמהרית לפני שמקימים שרת.
//  3. 'demo'   – תשובות לדוגמה קבועות. לבדיקת החוויה עם מבוגרים, בלי שום חיבור.

import { API_URL } from './config.js';
import { EXPLAIN_PROMPT, ASK_PROMPT, EXPLAIN_SCHEMA, ASK_SCHEMA } from './prompts.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

let backendPromise;
export function backend() {
  backendPromise ??= (async () => {
    if (API_URL) return { kind: 'server' };
    if (window.claude?.use) {
      try {
        const sample = await window.claude.use('sample');
        const limits = sample && await sample.limits().catch(() => null);
        if (sample && limits?.images) {
          const tts = await window.claude.use('tts').catch(() => null);
          return { kind: 'claude', sample, tts };
        }
      } catch { /* נמשיך להדגמה */ }
    }
    return { kind: 'demo' };
  })();
  return backendPromise;
}

// ---------- תשובות לדוגמה ----------
const DEMO_DOC = {
  demo: true, readable: true, document_type: 'invitation', event: 'חתונה', date: '2026-12-10', weekday_he: 'חמישי',
  time: '19:30', place: 'אולם "הגן", רחובות', missing: ['כתובת מלאה'], review_required: false, scam_warning: false,
  summary_am: 'ይህ የሰርግ ጥሪ ነው። ሰርጉ ሐሙስ፣ ታኅሣሥ 10 በፈረንጆች አቆጣጠር፣ ከምሽቱ አንድ ሰዓት ተኩል፣ በረሆቮት በሚገኘው ሀጋን አዳራሽ ነው። ሙሉ አድራሻው አልተጻፈም።',
  summary_he: 'זו הזמנה לחתונה. החתונה ביום חמישי, 10 בדצמבר, בשעה 19:30, באולם "הגן" ברחובות. הכתובת המלאה לא כתובה.',
};
const DEMO_ANSWER = {
  demo: true, understood: true, question_he: 'מתי החתונה?', review_required: false, scam_warning: false, emergency: false,
  answer_am: 'ሰርጉ ሐሙስ ከምሽቱ አንድ ሰዓት ተኩል ነው።', answer_he: 'החתונה ביום חמישי בשעה 19:30.',
};

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

// ---------- הפעולות ----------
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
  await wait(1500);
  return DEMO_DOC;
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
  await wait(1500);
  return DEMO_ANSWER;
}

/** קול אמהרי לתשובה. מחזיר URL של קובץ שמע, 'spoken' אם הוקרא, או null אם צריך גיבוי */
export async function speakResult(r) {
  const b = await backend();
  if (b.kind === 'server' && r.speak) {
    const res = await api('/api/speak', r.speak);
    return URL.createObjectURL(await res.blob());
  }
  if (b.kind === 'claude' && b.tts) {
    const text = r.summary_am ?? r.answer_am;
    try {
      await b.tts.speak(text, { language: 'am', rate: 0.85 });
      return 'spoken';
    } catch (e) {
      if (e?.code === 'not_granted') return 'spoken'; // הצופה כיבה הקראה – לא עוקפים
    }
  }
  return null;
}

export async function stopSpeaking() {
  const b = await backend();
  b.tts?.stop?.().catch(() => {});
}
