import { MAIN, EXTRAS, TILES, FACTS, EMERGENCY, TIMES, PHRASES, LESSONS } from './content.js';
import { loadSettings, saveSettings, newId, putBlob, getBlob, delBlob, resizeImage } from './store.js';
import { say, sayThen, startRecording, playUrl, stop } from './voice.js';
import { startWavRecording } from './recorder.js';
import { API_URL } from './config.js';

const app = document.getElementById('app');
let S = loadSettings();

// מצב זמני של השיחה הנוכחית (לא נשמר בשום מקום)
const session = { photo: null, doc: null, result: null, audioUrl: null, recorder: null };

// ---------- עזרים ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = o => (S.lang === 'am' ? o.am : o.he);
const sub = o => (S.lang === 'am' ? o.he : '');           // שורה קטנה בעברית לבני המשפחה
const sayText = o => ({ am: o.sayAm ?? o.am, he: o.sayHe ?? o.he });
const sayPhrase = k => say(k, PHRASES[k], S.lang);

// 0501234567 -> 972501234567 (לקישורי וואטסאפ)
export function intlPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d;
}
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+*#]/g, '');
const waHref = (p, text = '') => `https://wa.me/${intlPhone(p)}${text ? '?text=' + encodeURIComponent(text) : ''}`;

const go = (screen, arg) => { location.hash = arg !== undefined ? `${screen}/${arg}` : screen; };
const homeBtn = `<button class="home-btn" data-go="home" aria-label="בית">🏠</button>`;

async function fillPhotos() {
  for (const img of app.querySelectorAll('img[data-photo]')) {
    const b = await getBlob(img.dataset.photo);
    if (b) { img.src = URL.createObjectURL(b); img.hidden = false; img.nextElementSibling?.remove(); }
  }
}

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

// ---------- תקשורת עם השרת ----------
async function api(path, body) {
  const res = await fetch(API_URL.replace(/\/$/, '') + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('api ' + res.status);
  return res;
}

// תשובות לדוגמה כשאין שרת – כדי לבדוק את החוויה עם משתמשים לפני שמשקיעים בטכנולוגיה
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
const wait = ms => new Promise(r => setTimeout(r, ms));

async function explainPhoto(blob) {
  if (!API_URL) { await wait(1500); return DEMO_DOC; }
  return (await api('/api/explain', { image: await blobToBase64(blob), mime: 'image/jpeg' })).json();
}

async function askAudio(blob) {
  if (!API_URL) { await wait(1500); return DEMO_ANSWER; }
  const r = session.doc; // שאלה על המסמך האחרון שצולם
  const context = r && r.summary_he ? Object.fromEntries(
    ['document_type', 'event', 'date', 'weekday_he', 'time', 'place', 'sender', 'amount', 'deadline', 'action_he', 'summary_he']
      .filter(k => r[k]).map(k => [k, r[k]])) : undefined;
  return (await api('/api/ask', { audio: await blobToBase64(blob), mime: 'audio/wav', context })).json();
}

// משמיע את התשובה: קול אמהרי מהשרת, ואם אין – הקראה של הטלפון
async function playResult() {
  const r = session.result;
  if (!r) return;
  const am = r.summary_am ?? r.answer_am, he = r.summary_he ?? r.answer_he;
  try {
    if (!session.audioUrl && r.speak && API_URL) {
      const res = await api('/api/speak', r.speak);
      session.audioUrl = URL.createObjectURL(await res.blob());
    }
    if (session.audioUrl) return await playUrl(session.audioUrl);
  } catch { /* נמשיך להקראה */ }
  return say('result:x', { am, he }, S.lang);
}

function setResult(r) {
  if (session.audioUrl) URL.revokeObjectURL(session.audioUrl);
  session.audioUrl = null;
  session.result = r;
}

// ---------- מסכים ----------
const screens = {
  home() {
    return `
      <main class="main-actions">
        ${MAIN.map(t => `
          <button class="big ${t.color}" data-tile="${t.key}">
            <span class="icon">${t.icon}</span>
            <span class="txt"><span class="lbl">${esc(label(t))}</span><span class="sub">${esc(sub(t))}</span></span>
          </button>`).join('')}
      </main>
      <nav class="extras">
        ${EXTRAS.map(t => `
          <button class="small ${t.color}" data-tile="${t.key}" aria-label="${esc(t.he)}">
            <span class="icon">${t.icon}</span><span class="lbl">${esc(label(t))}</span>
          </button>`).join('')}
      </nav>
      <button class="gear" id="gear" aria-label="הגדרות (לחיצה ארוכה)">⚙️<span class="ring"></span></button>`;
  },

  // --- צילום מסמך ---
  doc() {
    if (!S.consented) return consentHtml('doc');
    return `${homeBtn}
      <main class="center">
        <label class="big-action yellow">
          <span class="icon">📷</span>
          <span class="lbl">${esc(label(MAIN[0]))}</span>
          <input type="file" accept="image/*" capture="environment" id="docPhoto" hidden>
        </label>
        <div class="hint-icons" aria-hidden="true">📄 ☀️ ✋</div>
      </main>`;
  },

  // --- שאלה קולית ---
  ask() {
    if (!S.consented) return consentHtml('ask');
    const about = session.doc?.summary_he
      ? `<div class="about">📄 ${esc(session.doc.event || session.doc.sender || '')}</div>` : '';
    return `${homeBtn}
      <main class="center">
        ${about}
        <button class="mic" id="mic" aria-label="הקלטה">🎤</button>
        <p class="step-text small" id="micText">${esc(label(PHRASES.tapToTalk))}</p>
      </main>`;
  },

  working() {
    return `<main class="center working"><div class="spinner"></div><div class="step-icon">⏳</div>
      <p class="step-text">${esc(label(PHRASES.working))}</p></main>`;
  },

  result() {
    const r = session.result;
    if (!r) return screens.home();
    const isDoc = 'readable' in r;
    if ((isDoc && !r.readable) || r.understood === false) {
      return `${homeBtn}<main class="center">
        <div class="step-icon">${isDoc ? '📷❓' : '🎤❓'}</div>
        <p class="step-text small">${esc(S.lang === 'am' ? (r.summary_am ?? r.answer_am) : (r.summary_he ?? r.answer_he))}</p>
        <div class="step-nav">
          <button class="again" data-play aria-label="שוב">🔁</button>
          <button class="next yellow" data-go="${isDoc ? 'doc' : 'ask'}" aria-label="שוב">${isDoc ? '📷' : '🎤'}</button>
        </div></main>`;
    }
    const facts = isDoc ? FACTS.filter(f => r[f.key]).map(f => {
      let v = r[f.key];
      if (f.key === 'date' || f.key === 'deadline') v = formatDate(v, f.key === 'date' ? r.weekday_he : '');
      return `<div class="fact"><span class="icon">${f.icon}</span><span><small>${f.he}</small>${esc(v)}</span></div>`;
    }).join('') : `<div class="fact"><span class="icon">❓</span><span>${esc(r.question_he || '')}</span></div>`;
    const warn = r.scam_warning ? 'scam' : r.emergency ? 'emergency' : r.review_required ? 'review' : '';
    return `${homeBtn}
      <main class="result">
        ${r.demo ? `<div class="demo">🧪 ${esc(PHRASES.demo.he)}</div>` : ''}
        ${warn === 'scam' ? `<button class="warn red" data-say="scam">⚠️💰🚫 ${esc(label(PHRASES.scam))}</button>` : ''}
        ${warn === 'review' ? `<button class="warn yellow" data-say="review">⚠️🙋 ${esc(label(PHRASES.review))}</button>` : ''}
        ${warn === 'emergency' ? `<button class="warn red" data-emergency="mda">🚑 101</button>` : ''}
        <button class="play" data-play aria-label="השמעה">🔊</button>
        <div class="facts">${facts}</div>
        <details class="fulltext"><summary>📝 הטקסט בעברית (לבני משפחה)</summary><p>${esc(r.summary_he ?? r.answer_he)}</p></details>
        <div class="result-nav">
          <button class="blue" data-go="ask" aria-label="לשאול">🎤</button>
          <button class="green ${warn ? 'pulse' : ''}" data-go="human" aria-label="עזרה מאדם">🙋</button>
        </div>
      </main>`;
  },

  // --- עזרה מאדם ---
  human() {
    if (!S.helperPhone) return `${homeBtn}<p class="empty" data-say="noHelper">🙋 ❓<br>${esc(label(PHRASES.noHelper))}</p>`;
    return `${homeBtn}
      <main class="list">
        <a class="row green" href="${telHref(S.helperPhone)}" data-helpcall><span class="icon">📞</span>
          <span class="lbl">${esc(label(PHRASES.call))}</span></a>
        <button class="row wa" data-helpwa><span class="icon">💬</span>
          <span class="lbl">${esc(label(PHRASES.whatsapp))}</span>${session.photo ? '<span class="num">📄</span>' : ''}</button>
      </main>`;
  },

  family() {
    if (!S.contacts.length) return `${homeBtn}<p class="empty" data-say="noFamily">👨‍👩‍👧 ❓<br>${esc(label(PHRASES.noFamily))}</p>`;
    return `${homeBtn}
      <main class="people">
        ${S.contacts.map(c => `
          <div class="person">
            <button class="face" data-call="${c.id}">
              <img data-photo="photo:${c.id}" alt="" hidden><span class="initial">${esc(c.name.slice(0, 1))}</span>
              <span class="name">${esc(c.name)}</span>
            </button>
            <div class="actions">
              <button class="act green" data-call="${c.id}" aria-label="${esc(label(PHRASES.call))}">📞</button>
              <button class="act wa" data-wa="${c.id}" aria-label="WhatsApp">💬</button>
            </div>
          </div>`).join('')}
      </main>`;
  },

  emergency() {
    return `${homeBtn}
      <main class="list">
        ${EMERGENCY.map(e => `
          <button class="row red" data-emergency="${e.key}">
            <span class="icon">${e.icon}</span>
            <span class="lbl">${esc(label(e))}<small>${esc(sub(e))}</small></span>
            <span class="num">${e.number}</span>
          </button>`).join('')}
        ${S.contacts[0] ? `
          <button class="row green" data-call="${S.contacts[0].id}">
            <span class="icon"><img data-photo="photo:${S.contacts[0].id}" alt="" hidden><span>👤</span></span>
            <span class="lbl">${esc(S.contacts[0].name)}</span><span class="num">📞</span>
          </button>` : ''}
      </main>`;
  },

  meds() {
    if (!S.meds.length) return `${homeBtn}<p class="empty" data-say="noMeds">💊 ❓<br>${esc(label(PHRASES.noMeds))}</p>`;
    return `${homeBtn}
      <main class="list">
        ${TIMES.map(t => {
          const list = S.meds.filter(m => m.times.includes(t.key));
          if (!list.length) return '';
          return `<section class="time ${nowTime() === t.key ? 'now' : ''}">
            <button class="time-head" data-time="${t.key}"><span class="icon">${t.icon}</span>${esc(label(t))}</button>
            <div class="pills">
              ${list.map(m => `
                <button class="pill" data-med="${m.id}">
                  <img data-photo="photo:${m.id}" alt="" hidden><span class="icon">💊</span>
                  <span class="name">${esc(m.name)}</span>
                </button>`).join('')}
            </div>
          </section>`;
        }).join('')}
      </main>`;
  },

  learn() {
    return `${homeBtn}
      <main class="grid">
        ${LESSONS.map(l => `
          <button class="tile purple" data-lesson="${l.key}">
            <span class="icon">${l.icon}</span>
            <span class="lbl">${esc(label(l))}</span>
            <span class="sub">${esc(sub(l))}</span>
          </button>`).join('')}
      </main>`;
  },

  lesson(arg) {
    const [key, n = '0'] = (arg || '').split('.');
    const l = LESSONS.find(x => x.key === key);
    if (!l) return screens.learn();
    const i = Math.min(+n, l.steps.length);
    if (i === l.steps.length) {
      return `${homeBtn}<main class="center"><div class="step-icon">🎉</div>
        <p class="step-text">${esc(label(PHRASES.done))}</p>
        <button class="next green" data-go="learn">✔</button></main>`;
    }
    const st = l.steps[i];
    return `${homeBtn}
      <main class="center lesson">
        <div class="dots">${l.steps.map((_, j) => `<span class="${j <= i ? 'on' : ''}"></span>`).join('')}</div>
        <div class="step-icon">${st.icon}</div>
        <p class="step-text">${esc(label(st))}</p>
        <div class="step-nav">
          <button class="again" data-again aria-label="שוב">🔁</button>
          <button class="next green" data-go="lesson" data-arg="${l.key}.${i + 1}" aria-label="הבא">▶</button>
        </div>
      </main>`;
  },

  settings: () => settingsHtml(),
};

function consentHtml(next) {
  return `${homeBtn}
    <main class="center">
      <div class="step-icon">🔒</div>
      <p class="step-text small">${esc(label(PHRASES.consent))}</p>
      <div class="step-nav">
        <button class="again red" data-go="home" aria-label="לא">✖</button>
        <button class="next green" data-consent="${next}" aria-label="כן">✔</button>
      </div>
    </main>`;
}

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
function formatDate(iso, weekday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso;
  return `${weekday ? 'יום ' + weekday + ', ' : ''}${+m[3]} ב${HE_MONTHS[+m[2] - 1]} ${m[1]}`;
}

function nowTime() {
  const h = new Date().getHours();
  return h < 11 ? 'morning' : h < 16 ? 'noon' : h < 21 ? 'evening' : 'night';
}

// מה להשמיע אוטומטית כשנכנסים למסך
function autoSay(screen, arg) {
  if ((screen === 'doc' || screen === 'ask') && !S.consented) return sayPhrase('consent');
  if (screen === 'ask') return sayPhrase('tapToTalk');
  if (screen === 'working') return sayPhrase('working');
  if (screen === 'result') return playResult();
  const t = TILES.find(x => x.key === screen);
  if (t) return say(t.key, sayText(t), S.lang);
  if (screen === 'lesson') {
    const [key, n = '0'] = (arg || '').split('.');
    const l = LESSONS.find(x => x.key === key);
    if (!l) return;
    const st = l.steps[+n];
    return st ? say(`lesson-${l.key}-${+n + 1}`, st, S.lang) : sayPhrase('done');
  }
  const empty = app.querySelector('[data-say]');
  if (empty) sayPhrase(empty.dataset.say);
}

function render() {
  const [screen = 'home', arg] = location.hash.slice(1).split('/');
  if (screen !== 'ask' && session.recorder) { session.recorder.stop(); session.recorder = null; }
  const fn = screens[screen] || screens.home;
  app.innerHTML = fn(arg);
  document.documentElement.lang = screen === 'settings' ? 'he' : S.lang;
  document.documentElement.dir = screen === 'settings' || S.lang === 'he' ? 'rtl' : 'ltr';
  fillPhotos();
  if (screen === 'settings') bindSettings();
  else if (screen === 'home') { stop(); bindGear(); }
  else autoSay(screen, arg);
  if (screen === 'doc') bindDoc();
  if (screen === 'ask') bindAsk();
  window.scrollTo(0, 0);
}

// ---------- צילום → הסבר ----------
function bindDoc() {
  const input = document.getElementById('docPhoto');
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    session.photo = await resizeImage(file, 1600); // מספיק חד כדי לקרוא עברית, קטן מספיק לרשת חלשה
    go('working');
    try {
      const r = await explainPhoto(session.photo);
      session.doc = r.readable ? r : null;
      setResult(r);
      go('result');
    } catch {
      app.innerHTML = errorHtml(); sayPhrase('error');
    }
  });
}

// ---------- שאלה קולית: לגעת → לדבר → לגעת שוב ----------
function bindAsk() {
  const mic = document.getElementById('mic');
  if (!mic) return;
  mic.addEventListener('click', async () => {
    if (!session.recorder) {
      stop();
      try { session.recorder = await startWavRecording(); } catch { alert('🎤 ❌'); return; }
      mic.classList.add('on'); mic.textContent = '⏹';
      return;
    }
    const { blob, seconds } = await session.recorder.stop();
    session.recorder = null;
    if (seconds < 1) { render(); return; }
    go('working');
    try {
      setResult(await askAudio(blob));
      go('result');
    } catch {
      app.innerHTML = errorHtml(); sayPhrase('error');
    }
  });
}

function errorHtml() {
  return `${homeBtn}<main class="center"><div class="step-icon">😕</div>
    <p class="step-text small">${esc(label(PHRASES.error))}</p>
    <div class="step-nav"><button class="again" data-go="human">🙋</button>
    <button class="next yellow" data-go="doc">📷</button></div></main>`;
}

// ---------- עזרה מאדם: שולח את התמונה וההסבר לעוזר בוואטסאפ ----------
async function sendToHelper() {
  const r = session.result;
  const text = ['שלום, אני צריך/ה עזרה 🙏', r?.summary_he || r?.answer_he ? `מה המערכת הבינה: ${r.summary_he ?? r.answer_he}` : '']
    .filter(Boolean).join('\n');
  if (session.photo) {
    const f = new File([session.photo], 'document.jpg', { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [f] })) {
      try { await navigator.share({ files: [f], text }); return sayPhrase('sent'); } catch { return; }
    }
  }
  location.href = waHref(S.helperPhone, text);
}

// ---------- לחיצות ----------
app.addEventListener('click', e => {
  const b = e.target.closest('button, [data-say], a');
  if (!b) return;
  const d = b.dataset;
  const contact = id => S.contacts.find(c => c.id === id);

  if (d.go) return go(d.go, d.arg);
  if (d.tile) return go(d.tile); // המסך עצמו משמיע את השם
  if (d.consent) { S.consented = true; saveSettings(S); return render(); }
  if (d.play !== undefined) return playResult();
  if (d.helpwa !== undefined) return sendToHelper();
  if (d.call) {
    const c = contact(d.call);
    return sayThen('contact:' + c.id, { he: c.name, am: c.name }, S.lang, () => (location.href = telHref(c.phone)));
  }
  if (d.wa) {
    const c = contact(d.wa);
    return sayThen('contact:' + c.id, { he: c.name, am: c.name }, S.lang, () => (location.href = waHref(c.phone)));
  }
  if (d.emergency) {
    const em = EMERGENCY.find(x => x.key === d.emergency);
    return sayThen(em.key, sayText(em), S.lang, () => (location.href = telHref(em.number)));
  }
  if (d.med) { const m = S.meds.find(x => x.id === d.med); return say('med:' + m.id, { he: m.name, am: m.name }, S.lang); }
  if (d.time) { const t = TIMES.find(x => x.key === d.time); return say('time-' + t.key, t, S.lang); }
  if (d.lesson) return go('lesson', d.lesson + '.0');
  if (d.again !== undefined) { const [, arg] = location.hash.slice(1).split('/'); return autoSay('lesson', arg); }
  if (d.say) return sayPhrase(d.say);
});

// גלגל השיניים: צריך להחזיק 3 שניות – כדי שלא ייכנסו להגדרות בטעות
function bindGear() {
  const g = document.getElementById('gear');
  let timer;
  const cancel = () => { clearTimeout(timer); g.classList.remove('holding'); };
  g.addEventListener('pointerdown', () => {
    g.classList.add('holding');
    timer = setTimeout(() => { cancel(); go('settings'); }, 3000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => g.addEventListener(ev, cancel));
  g.addEventListener('contextmenu', e => e.preventDefault());
}

// ---------- מסך הגדרות (לבני המשפחה, בעברית) ----------
function settingsHtml() {
  const recBtns = key => `
    <button type="button" class="mini rec" data-rec="${key}">🎙️ הקלטה</button>
    <button type="button" class="mini" data-playrec="${key}">🔊</button>`;
  return `
  <main class="settings">
    <header><h1>הגדרות למשפחה</h1><button class="mini" data-go="home">✖ סגירה</button></header>

    <section>
      <h2>שפת ההקראה</h2>
      <select id="lang">
        <option value="am" ${S.lang === 'am' ? 'selected' : ''}>አማርኛ אמהרית</option>
        <option value="he" ${S.lang === 'he' ? 'selected' : ''}>עברית</option>
      </select>
    </section>

    <section>
      <h2>מי עוזר? (כפתור 🙋)</h2>
      <p class="hint">מספר הוואטסאפ של בן/בת משפחה, מתנדב/ת, או של בוט ה"גשר" למתנדבים. לשם יישלחו מסמכים כשצריך עזרה מאדם.</p>
      <input id="helper" type="tel" value="${esc(S.helperPhone)}" placeholder="05X-XXXXXXX" dir="ltr">
    </section>

    <section>
      <h2>פרטיות</h2>
      <p class="hint">${S.consented ? '✅ ההורה אישר/ה שליחת תמונות והקלטות לעיבוד.' : 'עדיין לא ניתן אישור לשליחת תמונות והקלטות.'}
      תמונות והקלטות נשלחות לשירות AI כדי לקרוא ולהבין אותן ולא נשמרות בשרת שלנו.
      בשכבה החינמית של Google ייתכן שהמידע ישמש את Google לשיפור השירות – לכן בתקופת הניסוי כדאי להשתמש במסמכים לא רגישים.</p>
      ${S.consented ? '<button type="button" class="mini" id="revoke">ביטול האישור</button>' : ''}
    </section>

    <section>
      <h2>אנשי קשר</h2>
      <p class="hint">התמונה היא מה שההורה יזהה. כדאי להקליט את השם בקול שלכם, למשל: "זה דויד, הבן שלך".</p>
      ${S.contacts.map(c => `
        <div class="item">
          <img data-photo="photo:${c.id}" alt="" hidden><span class="ph">👤</span>
          <div class="grow"><b>${esc(c.name)}</b><br><span dir="ltr">${esc(c.phone)}</span></div>
          ${recBtns('contact:' + c.id)}
          <button type="button" class="mini danger" data-del-contact="${c.id}">🗑</button>
        </div>`).join('')}
      <form id="addContact" class="add">
        <input name="name" placeholder="שם" required>
        <input name="phone" type="tel" placeholder="טלפון 05X-XXXXXXX" required dir="ltr">
        <label class="file">📷 תמונה<input name="photo" type="file" accept="image/*" hidden></label>
        <button>➕ הוספה</button>
      </form>
    </section>

    <section>
      <h2>תרופות</h2>
      <p class="hint">צלמו את קופסת התרופה – ככה מזהים אותה בלי לקרוא.</p>
      ${S.meds.map(m => `
        <div class="item">
          <img data-photo="photo:${m.id}" alt="" hidden><span class="ph">💊</span>
          <div class="grow"><b>${esc(m.name)}</b><br>${m.times.map(t => TIMES.find(x => x.key === t).icon).join(' ')}</div>
          ${recBtns('med:' + m.id)}
          <button type="button" class="mini danger" data-del-med="${m.id}">🗑</button>
        </div>`).join('')}
      <form id="addMed" class="add">
        <input name="name" placeholder="שם התרופה / למה היא" required>
        <div class="times">${TIMES.map(t => `<label><input type="checkbox" name="t" value="${t.key}"> ${t.icon} ${t.he}</label>`).join('')}</div>
        <label class="file">📷 תמונה<input name="photo" type="file" accept="image/*" hidden></label>
        <button>➕ הוספה</button>
      </form>
    </section>

    <section>
      <h2>הקלטת הכפתורים בקול שלכם</h2>
      <p class="hint">אם המכשיר לא יודע להקריא אמהרית – הקליטו כאן כל כפתור. ההקלטה נשמרת רק בטלפון הזה.</p>
      ${[...TILES, ...EMERGENCY].map(t => `
        <div class="item"><span class="ph">${t.icon}</span>
          <div class="grow"><b>${t.he}</b><br><small>להגיד: ${esc(t.sayAm ?? t.am)}</small></div>
          ${recBtns(t.key)}</div>`).join('')}
    </section>

    <p class="hint">${API_URL ? '🟢 מחובר לשרת' : '🧪 מצב הדגמה – השרת עוד לא מחובר (config.js)'}</p>
  </main>`;
}

function bindSettings() {
  const persist = () => saveSettings(S);
  document.getElementById('lang').onchange = e => { S.lang = e.target.value; persist(); };
  document.getElementById('helper').onchange = e => { S.helperPhone = e.target.value.trim(); persist(); };
  const revoke = document.getElementById('revoke');
  if (revoke) revoke.onclick = () => { S.consented = false; persist(); render(); };

  const savePhoto = async (form, id) => {
    const f = form.photo.files[0];
    if (f) await putBlob('photo:' + id, await resizeImage(f));
  };

  document.getElementById('addContact').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, id = newId();
    await savePhoto(f, id);
    S.contacts.push({ id, name: f.name.value.trim(), phone: f.phone.value.trim() });
    persist(); render();
  };

  document.getElementById('addMed').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, id = newId();
    const times = [...f.querySelectorAll('input[name=t]:checked')].map(x => x.value);
    if (!times.length) return alert('בחרו לפחות זמן אחד');
    await savePhoto(f, id);
    S.meds.push({ id, name: f.name.value.trim(), times });
    persist(); render();
  };

  let recording;
  app.querySelector('.settings').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.delContact && confirm('למחוק?')) {
      S.contacts = S.contacts.filter(c => c.id !== d.delContact);
      await delBlob('photo:' + d.delContact); await delBlob('voice:contact:' + d.delContact);
      persist(); render();
    }
    if (d.delMed && confirm('למחוק?')) {
      S.meds = S.meds.filter(m => m.id !== d.delMed);
      await delBlob('photo:' + d.delMed); await delBlob('voice:med:' + d.delMed);
      persist(); render();
    }
    if (d.playrec) say(d.playrec, {}, S.lang);
    if (d.rec) {
      if (recording) {
        const blob = await recording.stop();
        recording = undefined;
        await putBlob('voice:' + d.rec, blob);
        b.classList.remove('on'); b.textContent = '✅ נשמר';
      } else {
        try {
          recording = await startRecording();
          b.classList.add('on'); b.textContent = '⏹ עצירה';
        } catch { alert('אין גישה למיקרופון'); }
      }
    }
  });
}

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
