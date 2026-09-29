/* ============================================================
   util.js - dates, DOM helpers, colour palette
   Everything hangs off one global, `G`, so the files can be
   loaded as classic <script> tags (works from file:// too).
   ============================================================ */
var G = window.G || {};
window.G = G;

G.util = (function () {

  /* ---------------------------------------------------------- dates
     Dates are stored as "YYYY-MM-DD" strings and manipulated as
     integer "day numbers" (days since the Unix epoch, in UTC).
     Using UTC throughout means daylight-saving never shifts a bar. */

  var MS_DAY = 86400000;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** "YYYY-MM-DD" -> integer day number */
  function toDay(iso) {
    var p = iso.split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / MS_DAY);
  }

  /** integer day number -> "YYYY-MM-DD" */
  function toISO(day) {
    var d = new Date(Math.round(day) * MS_DAY);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** integer day number -> JS Date (UTC midnight) */
  function toDate(day) { return new Date(Math.round(day) * MS_DAY); }

  /** today as an integer day number, in the viewer's local calendar */
  function today() {
    var n = new Date();
    return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / MS_DAY);
  }

  /** 0 = Sunday ... 6 = Saturday */
  function weekday(day) { return toDate(day).getUTCDay(); }
  function isWeekend(day) { var w = weekday(day); return w === 0 || w === 6; }

  /** day number of the Monday on or before `day` */
  function weekStart(day) {
    var w = weekday(day);
    return day - ((w + 6) % 7);          // Monday-based weeks, like Kitsu
  }

  /** ISO-8601 week number (1-53) */
  function isoWeek(day) {
    var d = toDate(day);
    var n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    n.setUTCDate(n.getUTCDate() + 4 - (n.getUTCDay() || 7));   // nearest Thursday
    var jan1 = new Date(Date.UTC(n.getUTCFullYear(), 0, 1));
    return Math.ceil((((n - jan1) / MS_DAY) + 1) / 7);
  }

  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var MON3   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DOW3   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  /** first day of the month containing `day` */
  function monthStart(day) {
    var d = toDate(day);
    return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / MS_DAY);
  }
  function monthLength(day) {
    var d = toDate(day);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  }

  /** "AUGUST 26" - Kitsu's month header format (month + 2-digit year) */
  function monthLabel(day) {
    var d = toDate(day);
    return MONTHS[d.getUTCMonth()] + ' ' + pad2(d.getUTCFullYear() % 100);
  }
  /** "Mon 14 Aug 2026" - used in tooltips and dialogs */
  function longLabel(day) {
    var d = toDate(day);
    return DOW3[d.getUTCDay()] + ' ' + pad2(d.getUTCDate()) + ' ' +
           MON3[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function dayLabel(day) { return pad2(toDate(day).getUTCDate()); }

  /** "5 days" / "1 day" */
  function durationLabel(n) { return n + (n === 1 ? ' day' : ' days'); }

  /* ---------------------------------------------------------- misc */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function uid(prefix) {
    return (prefix || 'id') + '_' +
      Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  /** debounce - trailing edge only */
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }

  /* ---------------------------------------------------------- DOM */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** set a CSS custom property on :root */
  function cssVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }

  /* ---------------------------------------------------------- colour */

  /* The first six are sampled straight off the reference screenshot -
     the colours Kitsu was using for Asset/Status, Episode/Sound,
     Episode/Edit, Shot/Cel, Shot/3D and Shot/Animation. The rest round
     the set out so a dozen categories can still be told apart.
     New categories cycle through this list in order. */
  var PALETTE = [
    '#f5587b', // pink    - Asset / Status
    '#29b6f6', // sky     - Episode / Sound
    '#a65ee8', // purple  - Episode / Edit
    '#ff5b49', // coral   - Shot / Cel
    '#5c6bc0', // indigo  - Shot / 3D
    '#00c29a', // teal    - Shot / Animation
    '#f9a03f', // amber
    '#f2d16b', // sand
    '#3ec9d6', // cyan
    '#e07be0', // orchid
    '#8d9aa8', // slate
    '#7c9a5a'  // olive
  ];

  function nextColor(i) { return PALETTE[i % PALETTE.length]; }

  /** "#abc" / "abcdef" / "#ABCDEF" -> "#abcdef", or null if unusable */
  function normalizeHex(s) {
    if (typeof s !== 'string') return null;
    var h = s.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return '#' + h.toLowerCase();
  }

  /* ---- recently used custom colours -------------------------------
     Kept per browser rather than in the document: they follow the
     person, not the schedule. */

  var RECENT_KEY = 'gantty.recentColors';
  var RECENT_MAX = 8;

  function recentColors() {
    try {
      var v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(v) ? v.filter(normalizeHex).slice(0, RECENT_MAX) : [];
    } catch (err) { return []; }
  }

  function rememberColor(hex) {
    hex = normalizeHex(hex);
    if (!hex || PALETTE.indexOf(hex) !== -1) return;      // presets need no memory
    var list = recentColors().filter(function (c) { return c !== hex; });
    list.unshift(hex);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); }
    catch (err) { /* nothing worth interrupting for */ }
  }

  /** #rrggbb -> {r,g,b} */
  function hexRGB(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  /** pick black or white text for legibility on `hex` */
  function readableInk(hex) {
    var c = hexRGB(hex);
    // perceived luminance (ITU-R BT.601)
    var l = (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
    return l > 150 ? '#12161b' : '#ffffff';
  }

  function mix(hex, amount, target) {
    var a = hexRGB(hex), b = hexRGB(target || '#000000');
    function m(x, y) { return Math.round(x + (y - x) * amount); }
    return '#' + [m(a.r, b.r), m(a.g, b.g), m(a.b, b.b)]
      .map(function (v) { return pad2hex(v); }).join('');
  }
  function pad2hex(v) { var s = v.toString(16); return s.length < 2 ? '0' + s : s; }

  /* ---------------------------------------------------------- export */

  return {
    MS_DAY: MS_DAY, MONTHS: MONTHS, MON3: MON3, DOW3: DOW3, PALETTE: PALETTE,
    pad2: pad2,
    toDay: toDay, toISO: toISO, toDate: toDate, today: today,
    weekday: weekday, isWeekend: isWeekend, weekStart: weekStart, isoWeek: isoWeek,
    monthStart: monthStart, monthLength: monthLength,
    monthLabel: monthLabel, longLabel: longLabel, dayLabel: dayLabel,
    durationLabel: durationLabel,
    clamp: clamp, uid: uid, deepCopy: deepCopy, debounce: debounce,
    el: el, $: $, $$: $$, cssVar: cssVar,
    nextColor: nextColor, hexRGB: hexRGB, readableInk: readableInk, mix: mix,
    normalizeHex: normalizeHex, recentColors: recentColors, rememberColor: rememberColor
  };
})();
