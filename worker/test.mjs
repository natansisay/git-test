// בדיקה מקומית בלי מפתחות אמיתיים: מחליפים את Gemini ו-Azure בתשובות מזויפות.
// הרצה: node test.mjs
import assert from 'node:assert/strict';
import worker from './src/index.js';

const env = {
  GEMINI_API_KEY: 'g', AZURE_SPEECH_KEY: 'a', AZURE_SPEECH_REGION: 'westeurope',
  SIGNING_SECRET: 'secret', ALLOWED_ORIGINS: 'https://example.github.io',
};

const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts });
  if (String(url).includes('generativelanguage')) {
    const body = JSON.parse(opts.body);
    const sys = body.system_instruction.parts[0].text;
    const isAsk = sys.includes('short voice recording');
    if (sys.includes('live interpreter')) {
      const fromUser = body.contents[0].parts[1].text.includes('from the USER');
      const out = fromUser
        ? { heard_ok: true, original: 'መድኃኒት ልወስድ ነው የመጣሁት', translation: 'באתי לקחת תרופה', needs_clarification: false, sensitive: false }
        : { heard_ok: true, original: 'תגיד לי את הקוד שקיבלת', translation: 'የደረሰዎትን ኮድ ይንገሩኝ', needs_clarification: false,
            sensitive: true, sensitive_note_am: 'ረዳትዎ ነው የሚናገረው። ኮድ ጠይቀዋል።' };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
    }
    const out = isAsk
      ? { understood: true, question_he: 'מתי החתונה?', answer_am: 'ሐሙስ ነው', answer_he: 'ביום חמישי', review_required: false, scam_warning: false, emergency: false }
      : { readable: true, document_type: 'invitation', event: 'חתונה', date: '2026-12-10', weekday_he: 'חמישי', time: '19:30',
          place: 'אולם הגן, רחובות', missing: ['full_address'], review_required: false, scam_warning: true,
          summary_am: 'ይህ የሰርግ ጥሪ ነው', summary_he: 'זו הזמנה לחתונה' };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
  }
  if (String(url).includes('tts.speech.microsoft.com')) {
    assert.match(opts.body, /am-ET-MekdesNeural|he-IL-HilaNeural/);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } });
  }
  throw new Error('unexpected ' + url);
};

const post = (path, body) => worker.fetch(new Request('https://w.dev' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.github.io' }, body: JSON.stringify(body),
}), env);

// 1. הסבר מסמך
let res = await post('/api/explain', { image: 'AAAA', mime: 'image/jpeg' });
assert.equal(res.status, 200);
assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://example.github.io');
const doc = await res.json();
assert.equal(doc.date, '2026-12-10');
assert.equal(doc.review_required, true, 'scam forces human review');
assert.ok(doc.speak.token, 'returns signed speak token');
const sent = JSON.parse(calls[0].opts.body);
assert.equal(sent.contents[0].parts[0].inline_data.data, 'AAAA');
assert.equal(sent.generationConfig.responseMimeType, 'application/json');

// 2. הקראה עם טוקן תקין
res = await post('/api/speak', doc.speak);
assert.equal(res.status, 200);
assert.equal(res.headers.get('Content-Type'), 'audio/mpeg');
assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);

// 3. הקראה של טקסט שלא השרת יצר – נחסם
res = await post('/api/speak', { text: 'משהו אחר', token: doc.speak.token });
assert.equal(res.status, 403);

// 4. שאלה קולית עם הקשר של המסמך
res = await post('/api/ask', { audio: 'UklG', mime: 'audio/wav', context: { event: 'חתונה' } });
const ans = await res.json();
assert.equal(res.status, 200);
assert.equal(ans.answer_am, 'ሐሙስ ነው');
assert.match(JSON.parse(calls.at(-1).opts.body).contents[0].parts[1].text, /חתונה/);

// 5. קלט לא תקין
assert.equal((await post('/api/explain', { image: 'x', mime: 'application/pdf' })).status, 400);
assert.equal((await post('/api/nothing', {})).status, 404);

// 6. מתורגמן: המשתמש מדבר אמהרית → עברית בקול עברי
res = await post('/api/translate', { audio: 'UklG', mime: 'audio/wav', speaker: 'user', history: [] });
const tr = await res.json();
assert.equal(tr.translation, 'באתי לקחת תרופה');
assert.equal(tr.speak.translation.lang, 'he');
assert.equal(tr.speak.sensitive, null);
res = await post('/api/speak', tr.speak.translation);
assert.equal(res.status, 200);
assert.match(calls.at(-1).opts.body, /he-IL-HilaNeural/);
// טוקן של עברית לא תקף לאמהרית
assert.equal((await post('/api/speak', { ...tr.speak.translation, lang: 'am' })).status, 403);

// 7. הרוקח מבקש קוד → אזהרה בקול של העוזר, באמהרית
res = await post('/api/translate', { audio: 'UklG', speaker: 'provider', history: [{ speaker: 'user', original: 'x' }] });
const tr2 = await res.json();
assert.equal(tr2.sensitive, true);
assert.equal(tr2.speak.translation.lang, 'am');
assert.equal(tr2.speak.sensitive.lang, 'am');
assert.match(JSON.parse(calls.filter(c => c.url.includes('generative')).at(-1).opts.body).contents[0].parts[1].text, /Recent conversation/);
assert.equal((await post('/api/translate', { audio: 'UklG', speaker: 'someone' })).status, 400);

// 8. בלי Azure – עדיין עובד, רק בלי קול
const { AZURE_SPEECH_KEY, ...noVoice } = env;
res = await worker.fetch(new Request('https://w.dev/api/explain', { method: 'POST', body: JSON.stringify({ image: 'A' }) }), noVoice);
assert.equal((await res.json()).speak, null);

console.log('✅ all worker tests passed');
