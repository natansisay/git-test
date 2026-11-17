// כל כפתור "מדבר". סדר העדיפויות:
// 1. הקלטה שבן משפחה הקליט בקולו (הכי טוב – קול מוכר, בשפה ובניב הנכונים)
// 2. קובץ שמע מוקלט מראש: audio/<lang>/<key>.mp3 (מתנדבים מקליטים פעם אחת לכולם)
// 3. הקראה אוטומטית של הדפדפן (לרוב אין קול אמהרי – אז מוקרא בעברית)

import { getBlob } from './store.js';

let current;

export function stop() {
  if (current) { current.pause(); current = undefined; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export function playUrl(url) {
  stop();
  return new Promise((resolve, reject) => {
    const a = new Audio(url);
    current = a;
    a.onended = () => resolve(true);
    a.onerror = () => reject(new Error('no audio'));
    a.play().catch(reject);
  });
}

function findVoice(prefix) {
  if (!('speechSynthesis' in window)) return undefined;
  return speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(prefix));
}

function tts(text, langCode) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window) || !text) return resolve(false);
    const u = new SpeechSynthesisUtterance(text);
    const v = findVoice(langCode);
    if (v) u.voice = v;
    u.lang = langCode === 'am' ? 'am-ET' : 'he-IL';
    u.rate = 0.85; // לאט וברור
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}

/**
 * להשמיע משהו.
 * @param {string} key   מזהה (למשל 'family' או 'contact:abc')
 * @param {{am?: string, he?: string}} text  טקסט לגיבוי
 * @param {string} lang  'am' | 'he'
 */
export async function say(key, text = {}, lang = 'am') {
  stop();
  // 1. הקלטה אישית
  const rec = await getBlob('voice:' + key);
  if (rec) {
    const url = URL.createObjectURL(rec);
    try { return await playUrl(url); } catch { /* נמשיך */ } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
  }
  // 2. קובץ מוקלט מראש
  if (!key.includes(':')) {
    try { return await playUrl(`audio/${lang}/${key}.mp3`); } catch { /* אין קובץ */ }
  }
  // 3. הקראה: אמהרית אם יש קול כזה במכשיר, אחרת עברית
  if (lang === 'am' && findVoice('am') && text.am) return tts(text.am, 'am');
  return tts(text.he || text.am, 'he');
}

/** להשמיע ואז לבצע פעולה – אבל לא לחכות יותר מכמה שניות */
export async function sayThen(key, text, lang, action, maxMs = 2500) {
  await Promise.race([say(key, text, lang), new Promise(r => setTimeout(r, maxMs))]);
  action();
}

// --- הקלטה (למסך ההגדרות) ---
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  const done = new Promise(resolve => {
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
  });
  rec.start();
  return { stop: () => { rec.stop(); return done; } };
}

if ('speechSynthesis' in window) speechSynthesis.getVoices(); // טוען את רשימת הקולות מראש
