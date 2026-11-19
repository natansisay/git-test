// משפחת אייקונים אחת, בקו עבה ופשוט – נראית אותו דבר בכל טלפון (בניגוד לאמוג'י).
// כל אייקון: 24x24, קו בעובי 2, פינות מעוגלות. הצבע נלקח מהטקסט (currentColor).

const P = {
  letter: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
  talk: '<circle cx="6" cy="9" r="2.5"/><path d="M2 20c0-3.2 1.8-5.5 4-5.5s4 2.3 4 5.5"/><circle cx="18" cy="9" r="2.5"/><path d="M14 20c0-3.2 1.8-5.5 4-5.5s4 2.3 4 5.5"/><path d="M9.5 2.5h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.5L12 9l-1-1.5H9.5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/>',
  help: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.5L8 14"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  speaker: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m3 17 5-5 4 4 3-3 6 5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  again: '<path d="M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4"/><path d="M20 12a8 8 0 0 1-14 5.3"/><path d="M6 21v-4h4"/>',
  slow: '<path d="M2 18.5h16.5a2.5 2.5 0 0 0 2.5-2.5v-2.5"/><circle cx="11.5" cy="12.5" r="5"/><path d="M11.5 12.5a1.8 1.8 0 1 0 1.8-1.8"/><path d="M21 13.5l1-3.5M19.5 13.5 18 10.5"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17v.01"/>',
  family: '<circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="7" r="2.5"/><circle cx="12" cy="13" r="2"/><path d="M3.5 19a4.5 4.5 0 0 1 9 0"/><path d="M11.5 19a4.5 4.5 0 0 1 9 0"/>',
  emergency: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
  pill: '<g transform="rotate(-35 12 12)"><rect x="2" y="7.5" width="20" height="9" rx="4.5"/><path d="M12 7.5H6.5a4.5 4.5 0 0 0 0 9H12z" fill="currentColor"/></g>',
  learn: '<path d="M2 9 12 4l10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/><path d="M22 9v5"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  building: '<path d="M4 21V5l8-2v18"/><path d="M12 9h8v12"/><path d="M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2"/><path d="M2 21h20"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2 2"/><path d="M4 5l3-2M20 5l-3-2"/>',
  todo: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5 2.5-2.5"/>',
  event: '<path d="M5 21 9 9l6 6z"/><path d="M14 4v2M19 9h2M17.5 5.5l-1.5 1.5"/><path d="M13 11c1-1 3-1 4 0"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  send: '<path d="M4 12 20 4l-5 16-3-7z"/><path d="m12 13 8-9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.5L8 14"/>',
  table: '<path d="M3 10h18"/><path d="M5 10v9M19 10v9"/><rect x="7" y="4" width="8" height="5" rx="0.5"/>',
  crop: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>',
  blur: '<circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="3"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5"/>',
  shield: '<path d="M12 3 4 6v5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>',
  flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7 10 6 12.5 6 15a6 6 0 0 0 6 6z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="M8 10.5h5M10.5 8v5"/>',
};

/** <svg> של אייקון. cls אופציונלי לגודל/צבע */
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.question}</svg>`;
}

export const ICON_NAMES = Object.keys(P);
