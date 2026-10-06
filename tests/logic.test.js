/* ============================================================
   logic.test.js - dates and the state model

   These are the parts where a bug corrupts a schedule silently
   rather than looking wrong on screen, so they get tests.
   Rendering and gestures are checked by hand in a browser.

       node tests/logic.test.js

   No dependencies: util.js and state.js are evaluated in a plain
   vm context with just enough of `window` and `localStorage` to
   keep them happy.
   ============================================================ */
global.window = { G: undefined, console: console };
global.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=v;}, };
global.setTimeout = setTimeout;
const fs = require('fs');
const vm = require('vm');
const ctx = { window: global.window, localStorage: global.localStorage, console, setTimeout, clearTimeout, JSON, Date, Math, parseInt, parseFloat, isFinite, Array, String, Object, Infinity };
ctx.global = ctx; vm.createContext(ctx);
for (const f of ['util.js','state.js']) vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','js',f),'utf8'), ctx, f);
const G = ctx.G, U = G.util, S = G.state;

let pass=0, fail=0;
function eq(a,b,msg){ if (JSON.stringify(a)===JSON.stringify(b)) {pass++;} else {fail++; console.log('FAIL',msg,'got',a,'want',b);} }

// --- date math
eq(U.toISO(U.toDay('2026-08-14')), '2026-08-14', 'iso roundtrip');
eq(U.toDay('2026-08-15')-U.toDay('2026-08-14'), 1, 'adjacent days');
eq(U.toDay('2026-03-01')-U.toDay('2026-02-28'), 1, 'feb->mar 2026');
eq(U.toDay('2024-03-01')-U.toDay('2024-02-28'), 2, 'leap year');
eq(U.weekday(U.toDay('2026-08-14')), 5, 'aug 14 2026 is a Friday');
eq(U.toISO(U.weekStart(U.toDay('2026-08-14'))), '2026-08-10', 'week starts Monday');
eq(U.toISO(U.weekStart(U.toDay('2026-08-10'))), '2026-08-10', 'monday is its own week start');
eq(U.isWeekend(U.toDay('2026-08-15')), true, 'saturday is weekend');
eq(U.isWeekend(U.toDay('2026-08-17')), false, 'monday is not');
eq(U.isoWeek(U.toDay('2026-08-10')), 33, 'iso week 33 matches screenshot');
eq(U.isoWeek(U.toDay('2026-08-17')), 34, 'iso week 34');
eq(U.isoWeek(U.toDay('2026-09-07')), 37, 'iso week 37');
eq(U.monthLabel(U.toDay('2026-08-03')), 'August 26', 'kitsu month label');
eq(U.monthLength(U.toDay('2026-02-05')), 28, 'feb 2026 length');
eq(U.monthLength(U.toDay('2024-02-05')), 29, 'feb 2024 length');
eq(U.readableInk('#f2d16b'), '#12161b', 'dark ink on sand');
eq(U.readableInk('#5c6bc0'), '#ffffff', 'light ink on indigo');

// --- state
S.load();
S.clearAll();
eq(S.groups().length, 0, 'cleared');
const g = S.addGroup('Shot / Cel');
eq(S.groups().length, 1, 'group added');
const base = U.today();
const t1 = S.addTask(g.id, {name:'A', start: base, end: base+3});
const t2 = S.addTask(g.id, {name:'B', start: base+10, end: base+12});
eq(S.groupSpan(g), {start: base, end: base+12}, 'summary spans children');

// dragging the summary moves every child together
S.setDates(g.id, base+5, base+17);
eq([t1.start-base, t1.end-base, t2.start-base, t2.end-base], [5,8,15,17], 'group drag shifts children');

// resizing a task keeps a minimum length
S.setDates(t1.id, base+5, base+5);
eq(t1.end - t1.start, 1, 'min one day with snapping on');

// undo unwinds the last change
S.undo();
// note: undo swaps in a fresh document, so re-look-up by id
eq(S.findTask(t1.id).end - S.findTask(t1.id).start, 3, 'undo restored length');

// range auto-grows to keep a task visible
S.setRange(base, 10);
S.addTask(g.id, {name:'far', start: base+40, end: base+45});
eq(S.view().origin + S.view().days >= base+45, true, 'range grew to fit');

// reorder
S.clearAll();
const a = S.addGroup('A'), b = S.addGroup('B'), c = S.addGroup('C');
S.reorder(c.id, a.id, true);
eq(S.groups().map(x=>x.name), ['C','A','B'], 'category moved to the top');

// round trip through save/load format
S.clearAll();
const g2 = S.addGroup('Round');
S.addTask(g2.id, {name:'T', start: base, end: base+4});
const json = JSON.parse(JSON.stringify(S.serialize()));
eq(json.groups[0].tasks[0].startDate, U.toISO(base), 'human start date written');
eq(json.groups[0].tasks[0].endDate, U.toISO(base+3), 'human end date is inclusive');
S.replace(json);
eq(S.groups()[0].tasks[0].end - S.groups()[0].tasks[0].start, 4, 'reloaded duration');

// importing a file that only has ISO dates
S.replace({name:'iso', groups:[{name:'G', tasks:[{name:'t', startDate:'2026-08-10', endDate:'2026-08-14'}]}]});
eq(S.groups()[0].tasks[0].end - S.groups()[0].tasks[0].start, 5, 'ISO-only import is 5 inclusive days');

// --- colour
eq(U.normalizeHex('#ABC'), '#aabbcc', 'short hex expands');
eq(U.normalizeHex('ff5b49'), '#ff5b49', 'bare hex gets a hash');
eq(U.normalizeHex('  #FF5B49 '), '#ff5b49', 'whitespace and case');
eq(U.normalizeHex('nope'), null, 'garbage rejected');
eq(U.normalizeHex('#ff5b4'), null, 'wrong length rejected');

// recolouring a category carries along only the tasks still wearing its
// old colour - a task given its own colour keeps it
S.clearAll();
const gc = S.addGroup('Colours');
const follower = S.addTask(gc.id, {name:'follows'});
const custom  = S.addTask(gc.id, {name:'custom'});
S.setColor(custom.id, '#123456');
S.setColor(gc.id, '#abcdef');
eq(S.findTask(follower.id).color, '#abcdef', 'follower took the new category colour');
eq(S.findTask(custom.id).color,  '#123456', 'customised task kept its own colour');
eq(S.findGroup(gc.id).color,     '#abcdef', 'category itself changed');

// ...unless you explicitly ask for everything to be reset
S.resetTaskColors(gc.id);
eq(S.findTask(custom.id).color, '#abcdef', 'reset overrides the customised task');

// --- the category column width is clamped on the way in
S.replace({name:'w', view:{sideWidth: 9999}, groups:[]});
eq(S.view().sideWidth, S.SIDE_MAX, 'absurdly wide column clamped down');
S.replace({name:'w', view:{sideWidth: 10}, groups:[]});
eq(S.view().sideWidth, S.SIDE_MIN, 'absurdly narrow column clamped up');
S.replace({name:'w', groups:[]});
eq(S.view().sideWidth, 320, 'missing width falls back to the default');

console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
