// אחסון מקומי על הטלפון בלבד – בלי שרת, בלי עלות, בלי לשלוח מידע לאף אחד.
// הגדרות (שמות, טלפונים) נשמרות ב-localStorage, תמונות והקלטות ב-IndexedDB.

const SETTINGS_KEY = 'beteseb-settings';

const DEFAULTS = {
  lang: 'am',          // שפת ההקראה: am / he
  contacts: [],        // [{id, name, phone}]  תמונה: photo:<id>, קול: voice:<id>
  meds: [],            // [{id, name, times: ['morning', ...]}]
  helperPhone: '',     // מספר וואטסאפ של מי שעוזר (מכתבים, שאלות)
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* מלא / חסום */ }
}

export const newId = () => Math.random().toString(36).slice(2, 10);

// --- IndexedDB קטן לקבצים (תמונות והקלטות) ---
let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('beteseb', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('blobs', mode);
    const r = fn(t.objectStore('blobs'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export const putBlob = (key, blob) => tx('readwrite', s => s.put(blob, key));
export const delBlob = (key) => tx('readwrite', s => s.delete(key));
export async function getBlob(key) {
  try { return await tx('readonly', s => s.get(key)); } catch { return undefined; }
}

// מקטין תמונה לפני שמירה כדי לא למלא את הטלפון
export function resizeImage(file, max = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('resize failed'))), 'image/jpeg', 0.82);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
