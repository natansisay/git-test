import { TILES, EMERGENCY, TIMES, PHRASES, LESSONS } from './content.js';
import { loadSettings, saveSettings, newId, putBlob, getBlob, delBlob, resizeImage } from './store.js';
import { say, sayThen, startRecording } from './voice.js';

const app = document.getElementById('app');
let S = loadSettings();

// ---------- עזרים ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = o => (S.lang === 'am' ? o.am : o.he);
const sub = o => (S.lang === 'am' ? o.he : '');           // שורה קטנה בעברית לבני המשפחה
const sayText = o => ({ am: o.sayAm ?? o.am, he: o.sayHe ?? o.he });

// 0501234567 -> 972501234567 (לקישורי וואטסאפ)
export function intlPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d;
}
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+*#]/g, '');
const waHref = (p, text = '') => `https://wa.me/${intlPhone(p)}${text ? '?text=' + encodeURIComponent(text) : ''}`;

function go(screen, arg) {
  location.hash = arg !== undefined ? `${screen}/${arg}` : screen;
}

const homeBtn = `<button class="home-btn" data-go="home" aria-label="בית">🏠</button>`;

// ממלא את כל התמונות שנשמרו במכשיר (img[data-photo])
async function fillPhotos() {
  for (const img of app.querySelectorAll('img[data-photo]')) {
    const b = await getBlob(img.dataset.photo);
    if (b) { img.src = URL.createObjectURL(b); img.hidden = false; img.nextElementSibling?.remove(); }
  }
}

// ---------- מסכים ----------
const screens = {
  home() {
    return `
      <main class="grid">
        ${TILES.map(t => `
          <button class="tile ${t.color}" data-tile="${t.key}">
            <span class="icon">${t.icon}</span>
            <span class="lbl">${esc(label(t))}</span>
            <span class="sub">${esc(sub(t))}</span>
          </button>`).join('')}
      </main>
      <button class="gear" id="gear" aria-label="הגדרות (לחיצה ארוכה)">⚙️<span class="ring"></span></button>`;
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

  letter() {
    return `${homeBtn}
      <main class="center">
        <label class="big-action yellow">
          <span class="icon">📷</span>
          <span class="lbl">${esc(label(PHRASES.takePhoto))}</span>
          <input type="file" accept="image/*" capture="environment" id="letterPhoto" hidden>
        </label>
        <p id="letterStatus" class="status"></p>
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
      return `${homeBtn}<main class="center" data-autosay="done"><div class="step-icon">🎉</div>
        <p class="step-text">${esc(label(PHRASES.done))}</p>
        <button class="next green" data-go="learn">✔</button></main>`;
    }
    const st = l.steps[i];
    return `${homeBtn}
      <main class="center lesson" data-autosay="lesson-${l.key}-${i + 1}">
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

function nowTime() {
  const h = new Date().getHours();
  return h < 11 ? 'morning' : h < 16 ? 'noon' : h < 21 ? 'evening' : 'night';
}

// מה להשמיע אוטומטית כשנכנסים למסך
function autoSay(screen, arg) {
  const t = TILES.find(x => x.key === screen);
  if (t) return say(t.key, sayText(t), S.lang);
  if (screen === 'lesson') {
    const [key, n = '0'] = (arg || '').split('.');
    const l = LESSONS.find(x => x.key === key);
    if (!l) return;
    const st = l.steps[+n];
    if (st) say(`lesson-${l.key}-${+n + 1}`, st, S.lang);
    else say('done', PHRASES.done, S.lang);
  }
  const empty = app.querySelector('[data-say]');
  if (empty) say(empty.dataset.say, PHRASES[empty.dataset.say], S.lang);
}

function render() {
  const [screen = 'home', arg] = location.hash.slice(1).split('/');
  const fn = screens[screen] || screens.home;
  app.innerHTML = fn(arg);
  document.documentElement.lang = screen === 'settings' ? 'he' : S.lang;
  document.documentElement.dir = screen === 'settings' || S.lang === 'he' ? 'rtl' : 'ltr';
  fillPhotos();
  if (screen === 'settings') bindSettings();
  else if (screen === 'home') bindGear();
  else autoSay(screen, arg);
  if (screen === 'letter') bindLetter();
  window.scrollTo(0, 0);
}

// ---------- לחיצות ----------
app.addEventListener('click', e => {
  const b = e.target.closest('button, [data-say]');
  if (!b) return;
  const d = b.dataset;
  const contact = id => S.contacts.find(c => c.id === id);

  if (d.go) return go(d.go, d.arg);
  if (d.tile) {
    const t = TILES.find(x => x.key === d.tile);
    return go(t.key); // המסך עצמו משמיע את השם
  }
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
  if (d.med) {
    const m = S.meds.find(x => x.id === d.med);
    return say('med:' + m.id, { he: m.name, am: m.name }, S.lang);
  }
  if (d.time) { const t = TIMES.find(x => x.key === d.time); return say('time-' + t.key, t, S.lang); }
  if (d.lesson) return go('lesson', d.lesson + '.0');
  if (d.again !== undefined) { const [, arg] = location.hash.slice(1).split('/'); return autoSay('lesson', arg); }
  if (d.say) return say(d.say, PHRASES[d.say], S.lang);
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

// צילום מכתב ושליחה לעוזר בוואטסאפ
function bindLetter() {
  const input = document.getElementById('letterPhoto');
  const status = document.getElementById('letterStatus');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (!S.helperPhone) { status.textContent = '❗ ' + label(PHRASES.noHelper); return say('noHelper', PHRASES.noHelper, S.lang); }
    const text = 'שלום, קיבלתי את המכתב הזה ואני צריך/ה עזרה להבין אותו 🙏';
    const shareFile = new File([file], 'letter.jpg', { type: file.type || 'image/jpeg' });
    try {
      // באנדרואיד: פותח את חלון השיתוף, בוחרים וואטסאפ ואת העוזר
      if (navigator.canShare?.({ files: [shareFile] })) {
        await navigator.share({ files: [shareFile], text });
      } else {
        location.href = waHref(S.helperPhone, text); // גיבוי: פותח צ'אט עם העוזר, מצרפים את התמונה ידנית
      }
      status.textContent = '✅ ' + label(PHRASES.sent);
      say('sent', PHRASES.sent, S.lang);
    } catch { /* המשתמש ביטל */ }
  });
}

// ---------- מסך הגדרות (לבני המשפחה, בעברית) ----------
function settingsHtml() {
  const recBtns = key => `
    <button type="button" class="mini rec" data-rec="${key}">🎙️ הקלטה</button>
    <button type="button" class="mini" data-play="${key}">🔊</button>`;
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
      <h2>מי עוזר עם מכתבים?</h2>
      <p class="hint">מספר הוואטסאפ שאליו יישלחו תמונות של מכתבים (בן/בת משפחה או מתנדב/ת).</p>
      <input id="helper" type="tel" value="${esc(S.helperPhone)}" placeholder="05X-XXXXXXX" dir="ltr">
    </section>

    <section>
      <h2>הקלטת הכפתורים בקול שלכם</h2>
      <p class="hint">אם המכשיר לא יודע להקריא אמהרית – הקליטו כאן כל כפתור. ההקלטה נשמרת רק בטלפון הזה.</p>
      ${[...TILES, ...EMERGENCY].map(t => `
        <div class="item"><span class="ph">${t.icon}</span>
          <div class="grow"><b>${t.he}</b><br><small>להגיד: ${esc(t.sayAm ?? t.am)}</small></div>
          ${recBtns(t.key)}</div>`).join('')}
    </section>

    <p class="hint">כל המידע נשמר רק במכשיר הזה. שום דבר לא נשלח לשרת.</p>
  </main>`;
}

function bindSettings() {
  const persist = () => { saveSettings(S); };
  document.getElementById('lang').onchange = e => { S.lang = e.target.value; persist(); };
  document.getElementById('helper').onchange = e => { S.helperPhone = e.target.value.trim(); persist(); };

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
    if (d.play) say(d.play, {}, S.lang);
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
