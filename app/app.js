import { MAIN, HELP, EXTRAS, TILES, FACTS, EMERGENCY, TIMES, PHRASES, LESSONS } from './content.js';
import { loadSettings, saveSettings, newId, putBlob, getBlob, delBlob, resizeImage } from './store.js';
import { say, sayThen, startRecording, stop } from './voice.js';
import { startWavRecording } from './recorder.js';
import { backend, explainPhoto, ask, translate, speak, speakFixedAm, stopSpeaking } from './ai.js';
import { icon } from './icons.js';

const app = document.getElementById('app');
let S = loadSettings();

// מצב זמני של השימוש הנוכחי (לא נשמר בשום מקום)
const session = {
  photo: null,       // התמונה האחרונה שצולמה
  photoUrl: null,
  doc: null,         // ההסבר של המסמך האחרון שנקרא בהצלחה – לשאלות המשך
  result: null,      // מה שמוצג במסך התשובה
  fails: 0,          // כמה צילומים לא הצליחו ברצף
  recorder: null,
  typed: false,      // המשתמש ביקש להקליד במקום לדבר
  talk: { turns: [], phase: 'user', busy: false, introduced: false, last: [] },
};

// ---------- עזרים ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = o => (S.lang === 'am' ? o.am : o.he) || o.he;
const sub = o => (S.lang === 'am' ? o.he : '');           // שורה קטנה בעברית לבני משפחה ולנותני שירות
const aria = o => `aria-label="${esc(L(o))}"`;              // שם נגיש בשפת המשתמש
const sayText = o => ({ am: o.sayAm ?? o.am, he: o.sayHe ?? o.he });
const sayPhrase = k => say(k, PHRASES[k], S.lang, () => S.lang === 'am' && speakFixedAm(PHRASES[k].am));
const sayTile = t => say(t.key, sayText(t), S.lang, () => S.lang === 'am' && speakFixedAm(sayText(t).am));

// 0501234567 -> 972501234567 (לקישורי וואטסאפ)
export function intlPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d;
}
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+*#]/g, '');
const waHref = (p, text = '') => `https://wa.me/${intlPhone(p)}${text ? '?text=' + encodeURIComponent(text) : ''}`;

// כתובות פשוטות בלבד (#doc, #lesson-answer-2) – כך זה עובד גם בדף ההדגמה ב-Claude
const go = (screen, arg) => { location.hash = arg !== undefined ? `${screen}-${arg}` : screen; };
function route() {
  const h = location.hash.slice(1);
  const i = h.indexOf('-');
  return i < 0 ? [h || 'home', undefined] : [h.slice(0, i), h.slice(i + 1)];
}

// הפס התחתון: בית + עזרה מאדם – תמיד באותו מקום
function bar({ home = true, help = true } = {}) {
  return `<nav class="bar">
    ${home ? `<button class="bar-home" data-go="home" ${aria(PHRASES.home)}>${icon('home')}</button>` : ''}
    ${help ? `<button class="bar-help" data-go="human" ${aria(HELP)}>${icon('help')}<span>${esc(L(HELP))}</span></button>` : ''}
  </nav>`;
}
const speakerBtn = (attr, cls = '') => `<button class="speaker ${cls}" ${attr} ${aria(PHRASES.speakerBtn)}>${icon('speaker')}</button>`;
// כותרת לכל מסך – כדי שתמיד יהיה ברור איפה נמצאים
const head = (ic, o, extra = '') => `<header class="screen-head">
    <span class="badge">${icon(ic)}</span>
    <div class="titles"><h1>${esc(L(o))}</h1>${sub(o) ? `<small lang="he">${esc(sub(o))}</small>` : ''}</div>${extra}
  </header><div class="tibeb" aria-hidden="true"></div>`;
const hero = (ic, cls = '') => `<div class="hero ${cls}">${icon(ic)}</div>`;

async function fillPhotos() {
  for (const img of app.querySelectorAll('img[data-photo]')) {
    const b = await getBlob(img.dataset.photo);
    if (b) { img.src = URL.createObjectURL(b); img.hidden = false; img.nextElementSibling?.remove(); }
  }
}

// ---------- השמעת תוצאה ----------
async function playResult(rate = 1) {
  const r = session.result;
  if (!r) return;
  const am = r.summary_am ?? r.answer_am, he = r.summary_he ?? r.answer_he;
  if (S.lang === 'am' && await speak({ text: am, lang: 'am', signed: r.speak }, { rate })) return;
  await speak({ text: he, lang: 'he' }, { rate });
}

// ---------- מסכים ----------
const screens = {
  home() {
    return `
      <header class="hello">
        <div class="titles"><h1>${esc(L(PHRASES.hello))}</h1>${sub(PHRASES.hello) ? `<small lang="he">${esc(sub(PHRASES.hello))}</small>` : ''}</div>
        ${speakerBtn('data-intro', 'big-speaker')}
      </header>
      <div class="tibeb" aria-hidden="true"></div>
      <main class="main-actions">
        ${MAIN.map(t => `
          <button class="big" data-tile="${t.key}" ${aria(t)}>
            <span class="big-ic">${icon(t.ic)}</span>
            <span class="txt"><span class="lbl">${esc(L(t))}</span><span class="sub" lang="he">${esc(sub(t))}</span></span>
            <span class="go">${icon('chevron')}</span>
          </button>`).join('')}
      </main>
      <p class="section-label">${esc(L(PHRASES.more))}</p>
      <nav class="extras">
        ${EXTRAS.map(t => `
          <button class="extra ${t.key === 'emergency' ? 'danger-outline' : ''}" data-tile="${t.key}" ${aria(t)}>
            <span class="ex-ic">${icon(t.ic)}</span><span class="lbl">${esc(L(t))}</span>
          </button>`).join('')}
      </nav>
      <button class="gear" id="gear" aria-label="הגדרות למשפחה (לחיצה ארוכה)">${icon('gear')}<span class="ring"></span></button>
      ${bar({ home: false })}`;
  },

  // --- מכתב: הנחיה אחת, ושני כפתורים אמיתיים ---
  doc() {
    return `
      ${head('letter', MAIN[0])}
      <main class="center">
        <div class="guide">
          <p class="step-text small">${esc(L(PHRASES.docGuide))}</p>
          ${speakerBtn('data-say="docGuide"')}
        </div>
        <button class="big-action primary" data-pick="camera">
          <span class="ba-ic">${icon('camera')}</span><span class="lbl">${esc(L(PHRASES.takePhoto))}</span>
        </button>
        <button class="wide secondary" data-pick="file">
          ${icon('image')}<span>${esc(L(PHRASES.choosePhoto))}</span>
        </button>
        <input type="file" accept="image/*" capture="environment" id="camInput" hidden>
        <input type="file" accept="image/*" id="fileInput" hidden>
      </main>
      ${bar()}`;
  },

  // --- הסכמה: אחרי שבחרו תמונה ולפני שליחה. אפשר לשמוע שוב. כן ולא באותו גודל ---
  consent(next) {
    const thumb = next === 'send' && session.photoUrl ? `<img class="thumb" src="${session.photoUrl}" alt="">` : hero('lock');
    return `
      <main class="center">
        ${thumb}
        <div class="guide">
          <p class="step-text small">${esc(L(PHRASES.consent))}</p>
          ${speakerBtn('data-say="consent"')}
        </div>
        <div class="yesno">
          <button class="no" data-consent-no="${next}" ${aria(PHRASES.no)}>${icon('x')}<span>${esc(L(PHRASES.no))}</span></button>
          <button class="yes" data-consent-yes="${next}" ${aria(PHRASES.yes)}>${icon('check')}<span>${esc(L(PHRASES.yes))}</span></button>
        </div>
      </main>
      ${bar()}`;
  },

  working() {
    return `<main class="center working" role="status"><div class="spinner"></div>
      <p class="step-text">${esc(L(PHRASES.working))}</p></main>${bar()}`;
  },

  result() {
    const r = session.result;
    if (!r) return screens.home();
    const isDoc = 'readable' in r;

    // צילום לא הצליח: מה בדיוק לתקן, ואחרי שני כישלונות – גם אדם
    if (isDoc && !r.readable) {
      const hint = PHRASES['hint_' + r.retake_hint] ? 'hint_' + r.retake_hint : 'hint_blurry';
      const ic = { cut_off: 'crop', blurry: 'blur', dark: 'moon', glare: 'sun', too_far: 'zoom', not_document: 'letter' }[r.retake_hint] || 'blur';
      const stuck = session.fails >= 2;
      return `
        <main class="center">
          ${hero(ic, 'caution')}
          <div class="guide">
            <p class="step-text small">${esc(L(PHRASES[hint]))}${stuck ? '<br>' + esc(L(PHRASES.stillStuck)) : ''}</p>
            ${speakerBtn('data-say-result')}
          </div>
          <button class="big-action primary" data-go="doc"><span class="ba-ic">${icon('camera')}</span><span class="lbl">${esc(L(PHRASES.again))}</span></button>
          ${stuck ? `<button class="wide help" data-go="human">${icon('phone')}<span>${esc(L(HELP))}</span></button>` : ''}
        </main>
        ${bar()}`;
    }
    if (r.understood === false) {
      return `
        <main class="center">
          ${hero('mic', 'caution')}
          <div class="guide"><p class="step-text small">${esc(L(PHRASES.notHeard))}</p>${speakerBtn('data-say="notHeard"')}</div>
          <button class="big-action primary" data-go="ask"><span class="ba-ic">${icon('mic')}</span><span class="lbl">${esc(L(PHRASES.again))}</span></button>
        </main>
        ${bar()}`;
    }

    const facts = isDoc ? FACTS.filter(f => r[f.key]).map(f => {
      let v = r[f.key];
      if (f.key === 'date' || f.key === 'deadline') v = formatDate(v, f.key === 'date' ? r.weekday_he : '');
      return `<div class="fact"><span class="f-ic">${icon(f.ic)}</span><span><small>${f.he}</small>${esc(v)}</span></div>`;
    }).join('') : `<div class="fact"><span class="f-ic">${icon('question')}</span><span>${esc(r.question_he || '')}</span></div>`;
    const missing = isDoc && r.missing?.length
      ? `<div class="fact muted"><span class="f-ic">${icon('warning')}</span><span><small>לא כתוב במסמך</small>${esc(r.missing.join(', '))}</span></div>` : '';
    const warn = r.scam_warning ? 'scam' : r.emergency ? 'emergency' : r.review_required ? 'review' : '';
    return `
      <main class="result">
        ${r.demo ? `<div class="demo">🧪 ${esc(PHRASES.demo.he)}</div>` : ''}
        ${r.via === 'claude' ? '<div class="demo">🤖 נקרא על ידי Claude (דף הדגמה)</div>' : ''}
        ${head(isDoc ? 'letter' : 'question', isDoc ? MAIN[0] : PHRASES.question)}
        ${warn === 'scam' ? `<button class="warn danger" data-say="scam">${icon('warning')}<span>${esc(L(PHRASES.scam))}</span></button>` : ''}
        ${warn === 'review' ? `<button class="warn caution" data-say="review">${icon('warning')}<span>${esc(L(PHRASES.review))}</span></button>` : ''}
        ${warn === 'emergency' ? `<button class="warn danger" data-emergency="mda">${icon('emergency')}<span>101</span></button>` : ''}
        <button class="play primary" data-say-result ${aria(PHRASES.speakerBtn)}>${icon('speaker')}</button>
        <div class="controls">
          <button data-say-result ${aria(PHRASES.again)}>${icon('again')}<span>${esc(L(PHRASES.again))}</span></button>
          <button data-slower ${aria(PHRASES.slower)}>${icon('slow')}<span>${esc(L(PHRASES.slower))}</span></button>
          <button data-go="ask" ${aria(PHRASES.question)}>${icon('mic')}<span>${esc(L(PHRASES.question))}</span></button>
        </div>
        <div class="facts">${facts}${missing}</div>
        <details class="fulltext"><summary>הטקסט בעברית (לבני משפחה)</summary><p>${esc(r.summary_he ?? r.answer_he)}</p></details>
      </main>
      ${bar()}`;
  },

  // --- שאלה על המכתב ---
  ask() {
    if (!S.consented) return screens.consent('ask');
    const about = session.doc?.summary_he
      ? `<div class="about">${icon('letter')}<span>${esc(session.doc.sender || session.doc.event || '')}</span></div>` : '';
    return `
      ${head('question', PHRASES.question)}
      <main class="center">
        ${about}
        <button class="mic" id="mic" ${aria(PHRASES.tapToTalk)}>${icon('mic')}</button>
        <div class="guide"><p class="step-text small" id="micText" role="status">${esc(L(PHRASES.tapToTalk))}</p>${speakerBtn('data-say="tapToTalk"')}</div>
        <div id="micFallback"></div>
      </main>
      ${bar()}`;
  },

  // --- לדבר עם אדם: מתורגמן בין המשתמש (אמהרית) לנותן השירות (עברית) ---
  talk() {
    if (!S.consented) return screens.consent('talk');
    const t = session.talk;
    const turns = t.turns.map(turnHtml).join('');
    let panel;
    if (t.busy) {
      panel = `<div class="talk-panel" role="status"><div class="spinner small"></div><p>${esc(L(PHRASES.working))}</p></div>`;
    } else if (t.phase === 'user') {
      panel = `<div class="talk-panel user">
        <button class="mic" id="mic" ${aria(PHRASES.yourTurn)}>${icon('mic')}</button>
        <p class="step-text small" id="micText" role="status">${esc(L(PHRASES.yourTurn))}</p>
        <div id="micFallback"></div>
      </div>`;
    } else {
      panel = `<div class="talk-panel provider" lang="he" dir="rtl">
        <p class="handover" lang="am">${icon('arrow')} ${esc(PHRASES.giveToProvider.am)}</p>
        <button class="mic provider" id="mic" aria-label="${esc(PHRASES.giveToProvider.he)}">${icon('mic')}</button>
        <p class="step-text small" id="micText" role="status">${esc(PHRASES.giveToProvider.he)}</p>
        <div id="micFallback"></div>
      </div>`;
    }
    const lastVerify = t.turns.at(-1)?.verify_hint_am;
    return `
      ${head('talk', MAIN[1])}
      <main class="talk">
        <div class="turns" id="turns" aria-live="polite">${turns || `<p class="talk-hint">${esc(L(PHRASES.talkIntro))}</p>`}</div>
        ${panel}
        <div class="controls">
          <button data-talk-again ${aria(PHRASES.again)} ${t.last.length ? '' : 'disabled'}>${icon('again')}<span>${esc(L(PHRASES.again))}</span></button>
          <button data-talk-slower ${aria(PHRASES.slower)} ${t.last.length ? '' : 'disabled'}>${icon('slow')}<span>${esc(L(PHRASES.slower))}</span></button>
          ${lastVerify ? `<button data-go="doc" aria-label="${esc(lastVerify)}">${icon('camera')}<span>${esc(L(PHRASES.takePhoto))}</span></button>` : ''}
        </div>
      </main>
      ${bar()}`;
  },

  // --- עזרה מאדם: שמים את השם לפני כל פעולה; שיחה ושיתוף מסמך הן שתי החלטות נפרדות ---
  human(arg) {
    if (!S.helperPhone) return helperSetupHtml();
    const name = esc(S.helperName || S.helperPhone);
    if (arg === 'share') {
      return `
        <main class="center">
          ${session.photoUrl ? `<img class="thumb" src="${session.photoUrl}" alt="">` : ''}
          <div class="guide"><p class="step-text small">${esc(L(PHRASES.shareDoc))} → ${name}</p>${speakerBtn('data-say-share')}</div>
          <div class="yesno">
            <button class="no" data-go="human" ${aria(PHRASES.no)}>${icon('x')}<span>${esc(L(PHRASES.no))}</span></button>
            <button class="yes" data-share-yes ${aria(PHRASES.yes)}>${icon('check')}<span>${esc(L(PHRASES.yes))}</span></button>
          </div>
        </main>${bar()}`;
    }
    return `
      ${head('help', HELP)}
      <main class="list">
        <button class="row primary" data-helpcall><span class="r-ic">${icon('phone')}</span><span class="lbl">${name}</span></button>
        <button class="row wa" data-helpwa><span class="r-ic">${icon('chat')}</span><span class="lbl">WhatsApp · ${name}</span></button>
        ${session.photo ? `<button class="row secondary" data-go="human" data-arg="share"><span class="r-ic">${icon('send')}</span><span class="lbl">${esc(L(PHRASES.shareDoc))}</span></button>` : ''}
        <button class="row danger" data-emergency="mda"><span class="r-ic">${icon('emergency')}</span><span class="lbl">${esc(L(EMERGENCY[0]))}</span><span class="num">101</span></button>
      </main>
      ${bar({ help: false })}`;
  },

  family() {
    if (!S.contacts.length) return contactSetupHtml();
    return `
      ${head('family', EXTRAS[0])}
      <main class="people">
        ${S.contacts.map(c => `
          <div class="person">
            <button class="face" data-call="${c.id}" aria-label="${esc(c.name)}">
              <img data-photo="photo:${c.id}" alt="" hidden><span class="initial">${esc(c.name.slice(0, 1))}</span>
              <span class="name">${esc(c.name)}</span>
            </button>
            <div class="actions">
              <button class="act primary" data-call="${c.id}" ${aria(PHRASES.call)}>${icon('phone')}</button>
              <button class="act wa" data-wa="${c.id}" aria-label="WhatsApp">${icon('chat')}</button>
            </div>
          </div>`).join('')}
      </main>
      ${bar()}`;
  },

  emergency() {
    return `
      ${head('emergency', EXTRAS[1])}
      <main class="list">
        ${EMERGENCY.map(e => `
          <button class="row danger" data-emergency="${e.key}" ${aria(e)}>
            <span class="r-ic">${icon(e.ic)}</span>
            <span class="lbl">${esc(L(e))}<small>${esc(sub(e))}</small></span>
            <span class="num">${e.number}</span>
          </button>`).join('')}
      </main>
      ${bar()}`;
  },

  meds() {
    if (!S.meds.length) {
      return `${head('pill', EXTRAS[2])}<main class="center">
        <div class="guide"><p class="step-text small">${esc(L(PHRASES.noMeds))}</p>${speakerBtn('data-say="noMeds"')}</div>
        <button class="wide secondary" data-go="setup">${icon('gear')}<span lang="he">להוספת תרופות (לבני משפחה)</span></button>
      </main>${bar()}`;
    }
    return `
      ${head('pill', EXTRAS[2])}
      <main class="list">
        ${TIMES.map(t => {
          const list = S.meds.filter(m => m.times.includes(t.key));
          if (!list.length) return '';
          return `<section class="time ${nowTime() === t.key ? 'now' : ''}">
            <button class="time-head" data-time="${t.key}" ${aria(t)}><span class="icon">${t.icon}</span>${esc(L(t))}</button>
            <div class="pills">
              ${list.map(m => `
                <button class="pill" data-med="${m.id}" aria-label="${esc(m.name)}">
                  <img data-photo="photo:${m.id}" alt="" hidden><span class="p-ic">${icon('pill')}</span>
                  <span class="name">${esc(m.name)}</span>
                </button>`).join('')}
            </div>
          </section>`;
        }).join('')}
      </main>
      ${bar()}`;
  },

  learn() {
    return `
      ${head('learn', EXTRAS[3])}
      <main class="grid">
        ${LESSONS.map(l => `
          <button class="tile" data-lesson="${l.key}" ${aria(l)}>
            <span class="icon">${l.icon}</span>
            <span class="lbl">${esc(L(l))}</span>
            <span class="sub">${esc(sub(l))}</span>
          </button>`).join('')}
      </main>
      ${bar()}`;
  },

  lesson(arg) {
    const [key, n = '0'] = (arg || '').split('-');
    const l = LESSONS.find(x => x.key === key);
    if (!l) return screens.learn();
    const i = Math.min(+n, l.steps.length);
    if (i === l.steps.length) {
      return `<main class="center"><div class="step-icon">🎉</div>
        <p class="step-text">${esc(L(PHRASES.done))}</p>
        <button class="big-action primary" data-go="learn" ${aria(PHRASES.yes)}><span class="ba-ic">${icon('check')}</span></button></main>${bar()}`;
    }
    const st = l.steps[i];
    return `
      <main class="center lesson">
        <div class="dots">${l.steps.map((_, j) => `<span class="${j <= i ? 'on' : ''}"></span>`).join('')}</div>
        <div class="step-icon">${st.icon}</div>
        <p class="step-text">${esc(L(st))}</p>
        <div class="yesno">
          <button class="no" data-again ${aria(PHRASES.again)}>${icon('again')}</button>
          <button class="yes" data-go="lesson" data-arg="${l.key}-${i + 1}" aria-label="▶">${icon('arrow')}</button>
        </div>
      </main>
      ${bar()}`;
  },

  setup: () => settingsHtml(),
};

// כשאין עוזר: לא מבוי סתום – הגדרה מודרכת עם מי שנמצא ליד (בעברית, בשבילו)
function helperSetupHtml() {
  return `
    <main class="center">
      ${hero('help')}
      <div class="guide"><p class="step-text small">${esc(L(PHRASES.helpSetup))}</p>${speakerBtn('data-say="helpSetup"')}</div>
      <form class="quick-setup" id="helperForm" lang="he" dir="rtl">
        <p class="hint">למי שעומד ליד: מי יעזור כשצריך? (בן/בת משפחה או מתנדב/ת)</p>
        <input id="qsName" name="name" placeholder="שם, למשל: דויד (הבן)" required>
        <input id="qsPhone" name="phone" type="tel" placeholder="טלפון 05X-XXXXXXX" required dir="ltr">
        <button class="wide primary">${icon('check')}<span>שמירה</span></button>
      </form>
      <button class="row danger" data-emergency="mda"><span class="r-ic">${icon('emergency')}</span><span class="lbl">${esc(L(EMERGENCY[0]))}</span><span class="num">101</span></button>
    </main>
    ${bar({ help: false })}`;
}

function contactSetupHtml() {
  return `
    <main class="center">
      ${hero('family')}
      <div class="guide"><p class="step-text small">${esc(L(PHRASES.noFamily))}</p>${speakerBtn('data-say="noFamily"')}</div>
      <form class="quick-setup" id="familyForm" lang="he" dir="rtl">
        <p class="hint">למי שעומד ליד: הוסיפו בן משפחה. התמונה היא מה שיזהו.</p>
        <input id="qfName" name="name" placeholder="שם" required>
        <input id="qfPhone" name="phone" type="tel" placeholder="טלפון 05X-XXXXXXX" required dir="ltr">
        <label class="wide secondary file">${icon('camera')}<span>תמונה</span><input id="qfPhoto" name="photo" type="file" accept="image/*" hidden></label>
        <button class="wide primary">${icon('check')}<span>שמירה</span></button>
      </form>
    </main>
    ${bar()}`;
}

function turnHtml(t) {
  const fromUser = t.speaker === 'user';
  const main = `<div class="bubble ${fromUser ? 'from-user' : 'from-provider'}">
      <span class="who">${icon(fromUser ? 'mic' : 'building')}</span>
      <div><p class="said" lang="${fromUser ? 'am' : 'he'}">${esc(t.original)}</p>
      <p class="translated" lang="${fromUser ? 'he' : 'am'}" dir="${fromUser ? 'rtl' : 'ltr'}">${esc(t.translation)}</p></div>
    </div>`;
  const notes = [
    t.needs_clarification && t.clarify_question ? `<div class="bubble assistant">${icon('question')}<p>${esc(t.clarify_question)}</p></div>` : '',
    t.sensitive && t.sensitive_note_am ? `<div class="bubble assistant warn">${icon('warning')}<p>${esc(t.sensitive_note_am)}</p></div>` : '',
    t.verify_hint_am ? `<div class="bubble assistant">${icon('camera')}<p>${esc(t.verify_hint_am)}</p></div>` : '',
  ].join('');
  return main + notes;
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

// מה להשמיע כשנכנסים למסך
function autoSay(screen, arg) {
  if (screen === 'doc') return sayPhrase('docGuide');
  if (screen === 'consent' || ((screen === 'ask' || screen === 'talk') && !S.consented)) return sayPhrase('consent');
  if (screen === 'working') return sayPhrase('working');
  if (screen === 'ask') return sayPhrase('tapToTalk');
  if (screen === 'talk' && !session.talk.turns.length) return sayPhrase('talkIntro');
  if (screen === 'result') return sayResultScreen();
  if (screen === 'human' && !S.helperPhone) return sayPhrase('helpSetup');
  if (screen === 'human' && arg === 'share') return sayShare();
  if (screen === 'family' && !S.contacts.length) return sayPhrase('noFamily');
  if (screen === 'meds' && !S.meds.length) return sayPhrase('noMeds');
  if (screen === 'lesson') {
    const [key, n = '0'] = (arg || '').split('-');
    const l = LESSONS.find(x => x.key === key);
    if (!l) return;
    const st = l.steps[+n];
    return st ? say(`lesson-${l.key}-${+n + 1}`, st, S.lang, () => S.lang === 'am' && speakFixedAm(st.am)) : sayPhrase('done');
  }
  const t = TILES.find(x => x.key === screen);
  if (t) return sayTile(t);
}

async function sayResultScreen() {
  const r = session.result;
  if (r && 'readable' in r && !r.readable) {
    await sayPhrase(PHRASES['hint_' + r.retake_hint] ? 'hint_' + r.retake_hint : 'hint_blurry');
    if (session.fails >= 2) await sayPhrase('stillStuck');
    return;
  }
  if (r?.understood === false) return sayPhrase('notHeard');
  return playResult();
}

function sayShare() {
  const name = S.helperName || '';
  return say('share', { am: PHRASES.shareDoc.am + ' ' + name, he: PHRASES.shareDoc.he + ' ' + name }, S.lang);
}

function render() {
  const [screen, arg] = route();
  if (screen !== 'ask' && screen !== 'talk' && session.recorder) { session.recorder.stop(); session.recorder = null; }
  stop(); stopSpeaking();
  const fn = screens[screen] || screens.home;
  app.innerHTML = fn(arg);
  document.documentElement.lang = screen === 'setup' ? 'he' : S.lang;
  document.documentElement.dir = screen === 'setup' || S.lang === 'he' ? 'rtl' : 'ltr';
  fillPhotos();
  if (screen === 'setup') return bindSettings();
  if (screen === 'home') bindGear();
  else autoSay(screen, arg);
  if (screen === 'doc') bindDoc();
  if (screen === 'ask') bindMic('ask');
  if (screen === 'talk' && !session.talk.busy) bindMic('talk');
  if (screen === 'human' || screen === 'family') bindQuickSetup();
  if (screen === 'talk') document.getElementById('turns')?.lastElementChild?.scrollIntoView({ block: 'end' });
  else window.scrollTo(0, 0);
}

// ---------- מכתב: צילום → (הסכמה) → הבנה ----------
function bindDoc() {
  for (const input of [document.getElementById('camInput'), document.getElementById('fileInput')]) {
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      session.photo = await resizeImage(file, 1600); // חד מספיק לקריאת עברית, קטן מספיק לרשת חלשה
      if (session.photoUrl) URL.revokeObjectURL(session.photoUrl);
      session.photoUrl = URL.createObjectURL(session.photo);
      if (!S.consented) return go('consent', 'send');
      sendPhoto();
    });
  }
}

async function sendPhoto() {
  go('working');
  try {
    const r = await explainPhoto(session.photo);
    if (r.readable) { session.fails = 0; session.doc = r; } else session.fails++;
    session.result = r;
    go('result');
  } catch {
    showError();
  }
}

function showError() {
  app.innerHTML = `<main class="center">${hero('warning', 'caution')}
    <div class="guide"><p class="step-text small">${esc(L(PHRASES.error))}</p>${speakerBtn('data-say="error"')}</div>
    <div class="yesno">
      <button class="no" data-go="doc" ${aria(PHRASES.again)}>${icon('again')}<span>${esc(L(PHRASES.again))}</span></button>
      <button class="yes" data-go="human" ${aria(HELP)}>${icon('help')}<span>${esc(L(HELP))}</span></button>
    </div></main>${bar()}`;
  sayPhrase('error');
}

// ---------- מיקרופון: לגעת → לדבר → נעצר לבד כשמפסיקים (או לגעת שוב) ----------
async function bindMic(mode) {
  const mic = document.getElementById('mic');
  if (!mic) return;
  const b = await backend();
  if (b.typed || session.typed) return showTyped(mode, mic);

  const finish = async () => {
    if (!session.recorder) return;
    const rec = session.recorder;
    session.recorder = null;
    const { blob, seconds } = await rec.stop();
    if (seconds < 0.8) return render();
    submit(mode, blob);
  };
  mic.addEventListener('click', async () => {
    if (session.recorder) return finish();
    await stopSpeaking(); stop();
    try {
      session.recorder = await startWavRecording({ onSilence: finish });
    } catch {
      return showMicFailure(mode, mic);
    }
    mic.classList.add('on'); mic.innerHTML = icon('stop');
    const isProvider = mode === 'talk' && session.talk.phase === 'provider';
    document.getElementById('micText').textContent = isProvider ? 'אני מקשיב. דברו.' : L(PHRASES.listening);
  });
}

// המיקרופון לא עבד: מסבירים, ונותנים שלוש דרכים להמשיך
function showMicFailure(mode, mic) {
  mic.classList.add('failed');
  const isProvider = mode === 'talk' && session.talk.phase === 'provider';
  document.getElementById('micText').textContent = isProvider ? 'המיקרופון לא עבד. נסו שוב או הקלידו.' : L(PHRASES.micFail);
  document.getElementById('micFallback').innerHTML = `
    <div class="controls">
      <button data-mic-retry ${aria(PHRASES.again)}>${icon('again')}<span>${esc(L(PHRASES.again))}</span></button>
      <button data-type-instead ${aria(PHRASES.typeIt)}>${icon('keyboard')}<span>${esc(L(PHRASES.typeIt))}</span></button>
      <button data-go="human" ${aria(HELP)}>${icon('help')}<span>${esc(L(HELP))}</span></button>
    </div>`;
  if (!isProvider) sayPhrase('micFail');
}

// הקלדה במקום דיבור (בדף ההדגמה, או כשאין מיקרופון)
function showTyped(mode, mic) {
  mic.hidden = true;
  const isProvider = mode === 'talk' && session.talk.phase === 'provider';
  const form = document.createElement('form');
  form.className = 'typed-ask';
  form.innerHTML = `
    <p class="demo">⌨️ כאן מקלידים. באתר האמיתי מדברים.</p>
    <textarea id="typedQ" rows="3" lang="${isProvider ? 'he' : S.lang}" dir="auto"
      placeholder="${isProvider ? 'כתבו כאן בעברית…' : esc(L(PHRASES.typeIt)) + '…'}"></textarea>
    <button class="wide primary" aria-label="➤">${icon('send')}</button>`;
  mic.after(form);
  form.onsubmit = e => {
    e.preventDefault();
    const q = form.querySelector('textarea').value.trim();
    if (q) submit(mode, q);
  };
}

async function submit(mode, input) {
  if (mode === 'ask') {
    go('working');
    try { session.result = await ask(input, session.doc); go('result'); } catch { showError(); }
    return;
  }
  // מתורגמן
  const t = session.talk;
  const speaker = t.phase;
  t.busy = true; render();
  let r;
  try { r = await translate(input, speaker, t.turns); } catch { t.busy = false; render(); return showError(); }
  t.busy = false;
  if (!r.heard_ok) {
    render();
    return speaker === 'user' ? sayPhrase('notHeard') : speak({ text: 'לא שמעתי. אפשר לחזור, לאט וקרוב לטלפון?', lang: 'he' });
  }
  t.turns.push(r);
  const [own, other] = speaker === 'user' ? ['am', 'he'] : ['he', 'am'];
  const sp = r.speak || {};
  const items = [{ text: r.translation, lang: other, signed: sp.translation }];
  if (r.needs_clarification && r.clarify_question) items.push({ text: r.clarify_question, lang: own, signed: sp.clarify });
  if (r.sensitive && r.sensitive_note_am) items.push({ text: r.sensitive_note_am, lang: 'am', signed: sp.sensitive });
  if (r.verify_hint_am) items.push({ text: r.verify_hint_am, lang: 'am', signed: sp.verify });
  if (!r.needs_clarification) t.phase = speaker === 'user' ? 'provider' : 'user';
  if (t.phase === 'provider' && !t.introduced) {
    t.introduced = true;
    items.push({ text: PHRASES.providerIntro.he, lang: 'he' });
  }
  t.last = items;
  render();
  playItems(items);
}

async function playItems(items, rate = 1) {
  for (const it of items) {
    const ok = await speak(it, { rate });
    if (!ok && it.lang === 'am') continue; // אין קול אמהרי במכשיר – הטקסט מוצג על המסך
  }
}

// ---------- עזרה מאדם ----------
function bindQuickSetup() {
  const hf = document.getElementById('helperForm');
  if (hf) hf.onsubmit = e => {
    e.preventDefault();
    S.helperName = hf.name.value.trim();
    S.helperPhone = hf.phone.value.trim();
    saveSettings(S); render();
  };
  const ff = document.getElementById('familyForm');
  if (ff) ff.onsubmit = async e => {
    e.preventDefault();
    const id = newId();
    const f = ff.querySelector('#qfPhoto').files[0];
    if (f) await putBlob('photo:' + id, await resizeImage(f));
    S.contacts.push({ id, name: ff.name.value.trim(), phone: ff.phone.value.trim() });
    saveSettings(S); render();
  };
}

async function shareDocWithHelper() {
  const r = session.doc;
  const text = ['שלום, אני צריך/ה עזרה עם המכתב הזה 🙏', r?.summary_he ? `מה המערכת הבינה: ${r.summary_he}` : ''].filter(Boolean).join('\n');
  if (session.photo) {
    const f = new File([session.photo], 'letter.jpg', { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [f] })) {
      try { await navigator.share({ files: [f], text }); return sayPhrase('sent'); } catch { return; }
    }
  }
  location.href = waHref(S.helperPhone, text);
}

// ---------- לחיצות ----------
app.addEventListener('click', async e => {
  const b = e.target.closest('button, [data-say]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  const contact = id => S.contacts.find(c => c.id === id);
  const nameSay = name => ({ am: name, he: name });

  if (d.go) return go(d.go, d.arg);
  if (d.tile) return go(d.tile); // המסך עצמו משמיע את השם
  if (d.intro !== undefined) return sayPhrase('homeIntro');
  if (d.pick) return document.getElementById(d.pick === 'camera' ? 'camInput' : 'fileInput').click();
  if (d.consentYes) {
    S.consented = true; saveSettings(S);
    if (d.consentYes === 'send') return sendPhoto();
    return route()[0] === d.consentYes ? render() : go(d.consentYes);
  }
  if (d.consentNo) { session.photo = null; return go('home'); }
  if (d.sayResult !== undefined) return sayResultScreen();
  if (d.slower !== undefined) return playResult(0.75);
  if (d.talkAgain !== undefined) return playItems(session.talk.last);
  if (d.talkSlower !== undefined) return playItems(session.talk.last, 0.75);
  if (d.sayShare !== undefined) return sayShare();
  if (d.micRetry !== undefined) return render();
  if (d.typeInstead !== undefined) { session.typed = true; return render(); }
  if (d.helpcall !== undefined) {
    return sayThen('helper', nameSay(S.helperName || ''), S.lang, () => (location.href = telHref(S.helperPhone)));
  }
  if (d.helpwa !== undefined) {
    return sayThen('helper', nameSay(S.helperName || ''), S.lang, () => (location.href = waHref(S.helperPhone)));
  }
  if (d.shareYes !== undefined) return shareDocWithHelper();
  if (d.call) {
    const c = contact(d.call);
    return sayThen('contact:' + c.id, nameSay(c.name), S.lang, () => (location.href = telHref(c.phone)));
  }
  if (d.wa) {
    const c = contact(d.wa);
    return sayThen('contact:' + c.id, nameSay(c.name), S.lang, () => (location.href = waHref(c.phone)));
  }
  if (d.emergency) {
    const em = EMERGENCY.find(x => x.key === d.emergency);
    return sayThen(em.key, sayText(em), S.lang, () => (location.href = telHref(em.number)));
  }
  if (d.med) { const m = S.meds.find(x => x.id === d.med); return say('med:' + m.id, nameSay(m.name), S.lang); }
  if (d.time) { const t = TIMES.find(x => x.key === d.time); return say('time-' + t.key, t, S.lang); }
  if (d.lesson) return go('lesson', d.lesson + '-0');
  if (d.again !== undefined) return autoSay('lesson', route()[1]);
  if (d.say) return sayPhrase(d.say);
});

// גלגל השיניים: צריך להחזיק 3 שניות – כדי שלא ייכנסו להגדרות בטעות
function bindGear() {
  const g = document.getElementById('gear');
  let timer;
  const cancel = () => { clearTimeout(timer); g.classList.remove('holding'); };
  g.addEventListener('pointerdown', () => {
    g.classList.add('holding');
    timer = setTimeout(() => { cancel(); go('setup'); }, 3000);
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
      <p class="hint">בן/בת משפחה, מתנדב/ת, או בוט ה"גשר" למתנדבים. השם נאמר בקול לפני שמתקשרים.</p>
      <input id="helperName" value="${esc(S.helperName)}" placeholder="שם, למשל: דויד (הבן)">
      <input id="helper" type="tel" value="${esc(S.helperPhone)}" placeholder="05X-XXXXXXX" dir="ltr">
    </section>

    <section>
      <h2>פרטיות</h2>
      <p class="hint">${S.consented ? '✅ ניתן אישור לשלוח תמונות והקלטות לעיבוד.' : 'עדיין לא ניתן אישור לשלוח תמונות והקלטות.'}
      תמונות והקלטות נשלחות לשירות AI כדי לקרוא ולהבין אותן. האתר שלנו לא שומר אותן.
      שימו לב: בשכבה החינמית של Google ייתכן שהתוכן ישמש את Google לשיפור השירות. לכן בתקופת הניסוי עדיף מסמכים לא רגישים.</p>
      ${S.consented ? '<button type="button" class="mini" id="revoke">ביטול האישור</button>' : ''}
    </section>

    <section>
      <h2>אנשי קשר</h2>
      <p class="hint">התמונה היא מה שיזהו. כדאי להקליט את השם בקול שלכם, למשל: "זה דויד, הבן שלך".</p>
      ${S.contacts.map(c => `
        <div class="item">
          <img data-photo="photo:${c.id}" alt="" hidden><span class="ph">👤</span>
          <div class="grow"><b>${esc(c.name)}</b><br><span dir="ltr">${esc(c.phone)}</span></div>
          ${recBtns('contact:' + c.id)}
          <button type="button" class="mini danger" data-del-contact="${c.id}">🗑</button>
        </div>`).join('')}
      <form id="addContact" class="add">
        <input id="cName" name="name" placeholder="שם" required>
        <input id="cPhone" name="phone" type="tel" placeholder="טלפון 05X-XXXXXXX" required dir="ltr">
        <label class="file">📷 תמונה<input id="cPhoto" name="photo" type="file" accept="image/*" hidden></label>
        <button>➕ הוספה</button>
      </form>
    </section>

    <section>
      <h2>תרופות</h2>
      <p class="hint">צלמו את קופסת התרופה – כך מזהים אותה בלי לקרוא.</p>
      ${S.meds.map(m => `
        <div class="item">
          <img data-photo="photo:${m.id}" alt="" hidden><span class="ph">💊</span>
          <div class="grow"><b>${esc(m.name)}</b><br>${m.times.map(t => TIMES.find(x => x.key === t).icon).join(' ')}</div>
          ${recBtns('med:' + m.id)}
          <button type="button" class="mini danger" data-del-med="${m.id}">🗑</button>
        </div>`).join('')}
      <form id="addMed" class="add">
        <input id="mName" name="name" placeholder="שם התרופה / למה היא" required>
        <div class="times">${TIMES.map(t => `<label><input type="checkbox" name="t" value="${t.key}"> ${t.icon} ${t.he}</label>`).join('')}</div>
        <label class="file">📷 תמונה<input id="mPhoto" name="photo" type="file" accept="image/*" hidden></label>
        <button>➕ הוספה</button>
      </form>
    </section>

    <section>
      <h2>הקלטת ההנחיות בקול שלכם</h2>
      <p class="hint">קול מוכר באמהרית הכי ברור. כל הקלטה נשמרת רק בטלפון הזה.</p>
      ${[...TILES, ...EMERGENCY].map(t => `
        <div class="item"><span class="ph">${t.icon}</span>
          <div class="grow"><b>${t.he}</b><br><small>להגיד: ${esc(t.sayAm ?? t.am)}</small></div>
          ${recBtns(t.key)}</div>`).join('')}
      ${['homeIntro', 'docGuide', 'consent', 'talkIntro', 'helpSetup'].map(k => `
        <div class="item"><span class="ph">🗣️</span>
          <div class="grow"><b>${esc(PHRASES[k].he)}</b><br><small>להגיד: ${esc(PHRASES[k].am)}</small></div>
          ${recBtns(k)}</div>`).join('')}
    </section>

    <p class="hint" id="backendState"></p>
  </main>`;
}

function bindSettings() {
  const persist = () => saveSettings(S);
  document.getElementById('lang').onchange = e => { S.lang = e.target.value; persist(); };
  document.getElementById('helper').onchange = e => { S.helperPhone = e.target.value.trim(); persist(); };
  document.getElementById('helperName').onchange = e => { S.helperName = e.target.value.trim(); persist(); };
  backend().then(b => {
    document.getElementById('backendState').textContent = {
      server: '🟢 מחובר לשרת', claude: '🤖 דף הדגמה ב-Claude – Claude קורא ומתרגם', demo: '🧪 מצב הדגמה – תשובות לדוגמה (השרת עוד לא מחובר)',
    }[b.kind];
  });
  const revoke = document.getElementById('revoke');
  if (revoke) revoke.onclick = () => { S.consented = false; persist(); render(); };

  const savePhoto = async (form, id) => {
    const f = form.querySelector('input[type=file]').files[0];
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
    if (!times.length) { f.querySelector('.times').classList.add('missing'); return; }
    await savePhoto(f, id);
    S.meds.push({ id, name: f.name.value.trim(), times });
    persist(); render();
  };

  let recording;
  app.querySelector('.settings').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if ((d.delContact || d.delMed) && !b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'בטוח? 🗑'; return; }
    if (d.delContact) {
      S.contacts = S.contacts.filter(c => c.id !== d.delContact);
      await delBlob('photo:' + d.delContact); await delBlob('voice:contact:' + d.delContact);
      persist(); render();
    }
    if (d.delMed) {
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
        } catch { b.textContent = '🎙️ ❌ אין מיקרופון'; }
      }
    }
  });
}

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
