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
    const isAsk = body.system_instruction.parts[0].text.includes('voice recording');
    const out = isAsk
      ? { understood: true, question_he: 'מתי החתונה?', answer_am: 'ሐሙስ ነው', answer_he: 'ביום חמישי', review_required: false, scam_warning: false, emergency: false }
      : { readable: true, document_type: 'invitation', event: 'חתונה', date: '2026-12-10', weekday_he: 'חמישי', time: '19:30',
          place: 'אולם הגן, רחובות', missing: ['full_address'], review_required: false, scam_warning: true,
          summary_am: 'ይህ የሰርግ ጥሪ ነው', summary_he: 'זו הזמנה לחתונה' };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
  }
  if (String(url).includes('tts.speech.microsoft.com')) {
    assert.match(opts.body, /am-ET-MekdesNeural/);
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

// 6. בלי Azure – עדיין עובד, רק בלי קול
const { AZURE_SPEECH_KEY, ...noVoice } = env;
res = await worker.fetch(new Request('https://w.dev/api/explain', { method: 'POST', body: JSON.stringify({ image: 'A' }) }), noVoice);
assert.equal((await res.json()).speak, null);

console.log('✅ all worker tests passed');
