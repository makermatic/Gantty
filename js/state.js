/* ============================================================
   state.js - the document model, undo/redo and persistence
   ============================================================

   DOCUMENT SHAPE
   --------------
   {
     version : 1,
     name    : "Untitled Schedule",
     view    : { origin, days, dayWidth, weekends, weekNums,
                 todayMarker, barLabels, freeDrag },
     groups  : [ { id, name, color, collapsed, tasks:[ task ] } ]
   }

   task = { id, name, color, start, end }

   `start` and `end` are FLOAT DAY NUMBERS (days since the Unix epoch,
   UTC).  `end` is EXCLUSIVE, so a one-day task is start = N, end = N+1
   and its width on screen is simply (end - start) * dayWidth.

   With snapping on (the default) these stay whole numbers and behave
   exactly like calendar dates.  With free dragging on they may carry a
   fraction, which is what lets a bar sit mid-day.  Saved JSON carries
   both the numbers and human-readable ISO dates.
   ============================================================ */

G.state = (function () {
  var U = G.util;

  var STORAGE_KEY = 'ganty.doc.v1';
  var LEGACY_KEY = 'gantty.doc.v1';   // the app was called Gantty until 2026-09-30
  var HISTORY_MAX = 80;

  var doc = null;
  var selection = null;            // { kind:'group'|'task', id }
  var undoStack = [];
  var redoStack = [];
  var listeners = [];

  /* ---------------------------------------------------------- defaults */

  function defaultView() {
    var t = U.today();
    return {
      origin: U.weekStart(t) - 7,   // start the week before this one
      days: 70,                     // ten weeks of runway
      dayWidth: 26,
      weekends: true,
      weekNums: true,
      todayMarker: true,
      barLabels: true,
      freeDrag: false
    };
  }

  function blankDoc() {
    return {
      version: 1,
      name: 'Untitled Schedule',
      view: defaultView(),
      groups: []
    };
  }

  /** A small starter schedule so the app is never a blank wall. */
  function sampleDoc() {
    var d = blankDoc();
    var t = U.weekStart(U.today());
    function grp(name, color, tasks) {
      return {
        id: U.uid('g'), name: name, color: color, collapsed: true,
        tasks: tasks.map(function (x) {
          return { id: U.uid('t'), name: x[0], color: color, start: t + x[1], end: t + x[2] };
        })
      };
    }
    d.groups = [
      grp('Asset / Design',  U.PALETTE[0], [['Lead design', 0, 5], ['Revisions', 5, 8]]),
      grp('Episode / Board', U.PALETTE[6], [['Board v1', 3, 9], ['Board lock', 9, 11]]),
      grp('Shot / Anim',     U.PALETTE[8], [['Blocking', 8, 14], ['Polish', 14, 21]])
    ];
    return d;
  }

  /* ---------------------------------------------------------- events */

  function onChange(fn) { listeners.push(fn); }
  function emit(reason) {
    for (var i = 0; i < listeners.length; i++) listeners[i](reason);
  }

  /* ---------------------------------------------------------- history

     Snapshots are cheap here (the documents are small) and they make
     every operation undoable without per-op bookkeeping.

     `tag` lets a continuous gesture coalesce: a whole drag pushes one
     entry, not one per mousemove. */

  var lastTag = null;

  function snapshot(tag) {
    if (tag && tag === lastTag) return;        // already captured this gesture
    lastTag = tag || null;
    undoStack.push(JSON.stringify(doc));
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack.length = 0;
  }
  function endGesture() { lastTag = null; }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(JSON.stringify(doc));
    doc = JSON.parse(undoStack.pop());
    lastTag = null;
    validateSelection();
    emit('undo');
    return true;
  }
  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(JSON.stringify(doc));
    doc = JSON.parse(redoStack.pop());
    lastTag = null;
    validateSelection();
    emit('redo');
    return true;
  }
  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  /* ---------------------------------------------------------- lookup */

  function groups() { return doc.groups; }

  function findGroup(id) {
    for (var i = 0; i < doc.groups.length; i++) if (doc.groups[i].id === id) return doc.groups[i];
    return null;
  }
  function findTask(id) {
    for (var i = 0; i < doc.groups.length; i++) {
      var ts = doc.groups[i].tasks;
      for (var j = 0; j < ts.length; j++) if (ts[j].id === id) return ts[j];
    }
    return null;
  }
  function parentOf(taskId) {
    for (var i = 0; i < doc.groups.length; i++) {
      var ts = doc.groups[i].tasks;
      for (var j = 0; j < ts.length; j++) if (ts[j].id === taskId) return doc.groups[i];
    }
    return null;
  }
  function find(id) { return findGroup(id) || findTask(id); }

  /** earliest start / latest end across a category's tasks, or null */
  function groupSpan(g) {
    if (!g.tasks.length) return null;
    var s = Infinity, e = -Infinity;
    for (var i = 0; i < g.tasks.length; i++) {
      if (g.tasks[i].start < s) s = g.tasks[i].start;
      if (g.tasks[i].end > e) e = g.tasks[i].end;
    }
    return { start: s, end: e };
  }

  /** span of the whole document, or null when empty */
  function docSpan() {
    var s = Infinity, e = -Infinity, any = false;
    doc.groups.forEach(function (g) {
      g.tasks.forEach(function (t) {
        any = true;
        if (t.start < s) s = t.start;
        if (t.end > e) e = t.end;
      });
    });
    return any ? { start: s, end: e } : null;
  }

  /** flat list of what is currently on screen, top to bottom */
  function visibleRows() {
    var out = [];
    doc.groups.forEach(function (g) {
      out.push({ kind: 'group', id: g.id, group: g });
      if (!g.collapsed) {
        g.tasks.forEach(function (t) {
          out.push({ kind: 'task', id: t.id, task: t, group: g });
        });
      }
    });
    return out;
  }

  /* ---------------------------------------------------------- mutation */

  function addGroup(name) {
    snapshot();
    var g = {
      id: U.uid('g'),
      name: name || 'New Category',
      color: U.nextColor(doc.groups.length),
      collapsed: false,
      tasks: []
    };
    doc.groups.push(g);
    selection = { kind: 'group', id: g.id };
    emit('add-group');
    return g;
  }

  function addTask(groupId, opts) {
    var g = findGroup(groupId);
    if (!g) return null;
    snapshot();
    opts = opts || {};

    var start, end;
    if (opts.start != null) {
      start = opts.start;
      end = (opts.end != null) ? opts.end : start + (opts.length || 5);
    } else {
      // place it after whatever is already in the category, else at today
      var span = groupSpan(g);
      start = span ? span.end : Math.max(U.today(), doc.view.origin);
      end = start + (opts.length || 5);
    }

    var t = {
      id: U.uid('t'),
      name: opts.name || ('Task ' + (g.tasks.length + 1)),
      color: opts.color || g.color,
      start: start,
      end: end
    };
    g.tasks.push(t);
    g.collapsed = false;
    selection = { kind: 'task', id: t.id };
    growRangeToFit(t.start, t.end);
    emit('add-task');
    return t;
  }

  function removeById(id) {
    snapshot();
    for (var i = 0; i < doc.groups.length; i++) {
      if (doc.groups[i].id === id) { doc.groups.splice(i, 1); break; }
      var ts = doc.groups[i].tasks;
      for (var j = 0; j < ts.length; j++) {
        if (ts[j].id === id) { ts.splice(j, 1); break; }
      }
    }
    validateSelection();
    emit('remove');
  }

  function duplicate(id) {
    snapshot();
    var g = findGroup(id);
    if (g) {
      var copy = U.deepCopy(g);
      copy.id = U.uid('g');
      copy.name = g.name + ' copy';
      copy.tasks.forEach(function (t) { t.id = U.uid('t'); });
      doc.groups.splice(doc.groups.indexOf(g) + 1, 0, copy);
      selection = { kind: 'group', id: copy.id };
    } else {
      var t = findTask(id), p = parentOf(id);
      if (!t || !p) return;
      var c = U.deepCopy(t);
      c.id = U.uid('t');
      c.name = t.name + ' copy';
      p.tasks.splice(p.tasks.indexOf(t) + 1, 0, c);
      selection = { kind: 'task', id: c.id };
    }
    emit('duplicate');
  }

  function rename(id, name) {
    var n = find(id);
    if (!n || n.name === name) return;
    snapshot('rename:' + id);
    n.name = name;
    emit('rename');
  }

  /**
   * Recolour a category or a single task.
   *
   * Recolouring a CATEGORY carries its tasks along - but only the ones
   * that were still wearing the category's old colour.  A task you have
   * deliberately given its own colour keeps it.  No extra field is
   * needed to track that: matching the old colour *is* the signal.
   *
   * `tag` coalesces the undo entry while a picker is being dragged.
   */
  function setColor(id, color, tag) {
    snapshot(tag);
    var g = findGroup(id);
    if (g) {
      var was = g.color;
      g.color = color;
      g.tasks.forEach(function (t) { if (t.color === was) t.color = color; });
    } else {
      var t = findTask(id);
      if (t) t.color = color;
    }
    emit('color');
  }

  /** force every task in a category back onto the category's colour */
  function resetTaskColors(id) {
    var g = findGroup(id);
    if (!g) return;
    snapshot();
    g.tasks.forEach(function (t) { t.color = g.color; });
    emit('color');
  }

  function toggleCollapse(id, force) {
    var g = findGroup(id);
    if (!g) return;
    g.collapsed = (force == null) ? !g.collapsed : !!force;
    emit('collapse');
  }

  function collapseAll(collapsed) {
    doc.groups.forEach(function (g) { g.collapsed = collapsed; });
    emit('collapse');
  }

  /**
   * Move a task's bar, or shift a whole category.
   * `tag` coalesces the undo entry for a continuous drag.
   */
  function setDates(id, start, end, tag) {
    snapshot(tag);
    var t = findTask(id);
    if (t) {
      t.start = start;
      t.end = Math.max(end, start + minLen());
    } else {
      var g = findGroup(id);
      if (!g) return;
      var span = groupSpan(g);
      if (!span) return;
      var delta = start - span.start;
      g.tasks.forEach(function (x) { x.start += delta; x.end += delta; });
    }
    growRangeToFit(start, end);
    emit('dates');
  }

  /** shift every task in the document by `delta` days */
  function shiftAll(delta) {
    if (!delta) return;
    snapshot();
    doc.groups.forEach(function (g) {
      g.tasks.forEach(function (t) { t.start += delta; t.end += delta; });
    });
    emit('shift');
  }

  /** move the whole schedule so its earliest task begins today */
  function startToday() {
    var span = docSpan();
    if (!span) return false;
    shiftAll(U.today() - span.start);
    return true;
  }

  function minLen() { return doc.view.freeDrag ? 0.25 : 1; }

  /* ---------------------------------------------------------- reordering */

  /**
   * Move a row to a new position.
   * `target` is { kind, id } of the row we are dropping onto and
   * `before` says whether we land above it.
   */
  function reorder(dragId, targetId, before) {
    var gSrc = findGroup(dragId);
    snapshot();

    if (gSrc) {
      // categories only reorder among categories
      var tg = findGroup(targetId) || parentOf(targetId);
      if (!tg || tg === gSrc) { emit('reorder'); return; }
      doc.groups.splice(doc.groups.indexOf(gSrc), 1);
      var at = doc.groups.indexOf(tg);
      doc.groups.splice(before ? at : at + 1, 0, gSrc);
    } else {
      var t = findTask(dragId), from = parentOf(dragId);
      if (!t || !from) { emit('reorder'); return; }
      from.tasks.splice(from.tasks.indexOf(t), 1);

      var toGroup = findGroup(targetId);
      if (toGroup) {
        // dropped on a category header -> becomes its first task
        toGroup.tasks.unshift(t);
        toGroup.collapsed = false;
      } else {
        var tt = findTask(targetId), to = parentOf(targetId);
        if (!to) { from.tasks.push(t); emit('reorder'); return; }
        var idx = to.tasks.indexOf(tt);
        to.tasks.splice(before ? idx : idx + 1, 0, t);
      }
    }
    emit('reorder');
  }

  /* ---------------------------------------------------------- view range */

  function view() { return doc.view; }

  function setView(patch) {
    var changed = false;
    for (var k in patch) {
      if (doc.view[k] !== patch[k]) { doc.view[k] = patch[k]; changed = true; }
    }
    if (changed) emit('view');
  }

  /** hard floor so the range can never collapse to nothing */
  var MIN_DAYS = 7;

  /**
   * Drag-the-end-of-the-timeline support (the Harmony-style grips).
   * Moving the LEFT grip changes both origin and length; moving the
   * RIGHT grip changes only the length.
   */
  function setRange(origin, days) {
    days = Math.max(MIN_DAYS, Math.round(days));
    origin = Math.round(origin);
    if (doc.view.origin === origin && doc.view.days === days) return;
    doc.view.origin = origin;
    doc.view.days = days;
    emit('range');
  }

  /** widen the range (never narrow it) so [start,end] is inside it */
  function growRangeToFit(start, end) {
    var v = doc.view, changed = false;
    var s = Math.floor(start), e = Math.ceil(end);
    if (s < v.origin) { v.days += v.origin - s; v.origin = s; changed = true; }
    if (e > v.origin + v.days) { v.days = e - v.origin; changed = true; }
    return changed;
  }

  /** shrink-wrap the range around the content, with a little padding */
  function fitRangeToContent(padDays) {
    var span = docSpan();
    if (!span) return false;
    var pad = padDays == null ? 3 : padDays;
    setRange(Math.floor(span.start) - pad, Math.ceil(span.end) - Math.floor(span.start) + pad * 2);
    return true;
  }

  /* ---------------------------------------------------------- selection */

  function getSelection() { return selection; }
  function select(kind, id) {
    selection = id ? { kind: kind, id: id } : null;
    emit('select');
  }
  function validateSelection() {
    if (selection && !find(selection.id)) selection = null;
  }

  /* ---------------------------------------------------------- persistence */

  function serialize() {
    var out = U.deepCopy(doc);
    // add readable dates alongside the numbers - handy if anyone opens
    // the .json by hand, ignored on load
    out.groups.forEach(function (g) {
      g.tasks.forEach(function (t) {
        t.startDate = U.toISO(Math.floor(t.start));
        t.endDate = U.toISO(Math.ceil(t.end) - 1);   // inclusive, for humans
      });
    });
    out.savedAt = new Date().toISOString();
    return out;
  }

  function normalize(raw) {
    var d = blankDoc();
    if (!raw || typeof raw !== 'object') return d;
    d.name = typeof raw.name === 'string' ? raw.name : d.name;

    if (raw.view && typeof raw.view === 'object') {
      for (var k in d.view) if (raw.view[k] !== undefined) d.view[k] = raw.view[k];
    }
    d.view.dayWidth = U.clamp(+d.view.dayWidth || 26, 3, 80);
    d.view.days = Math.max(MIN_DAYS, Math.round(+d.view.days || 70));
    d.view.origin = Math.round(+d.view.origin);
    if (!isFinite(d.view.origin)) d.view.origin = defaultView().origin;

    d.groups = (Array.isArray(raw.groups) ? raw.groups : []).map(function (g, gi) {
      return {
        id: g.id || U.uid('g'),
        name: String(g.name == null ? 'Category' : g.name),
        color: g.color || U.nextColor(gi),
        collapsed: !!g.collapsed,
        tasks: (Array.isArray(g.tasks) ? g.tasks : []).map(function (t) {
          // accept either the numeric form or plain ISO dates
          var s = (typeof t.start === 'number') ? t.start
                : (t.startDate ? U.toDay(t.startDate) : U.today());
          var e = (typeof t.end === 'number') ? t.end
                : (t.endDate ? U.toDay(t.endDate) + 1 : s + 1);
          return {
            id: t.id || U.uid('t'),
            name: String(t.name == null ? 'Task' : t.name),
            color: t.color || g.color || U.nextColor(gi),
            start: s,
            end: Math.max(e, s + 0.25)
          };
        })
      };
    });
    return d;
  }

  var save = U.debounce(function () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch (err) {
      // private mode, quota, file:// restrictions - autosave is a
      // convenience, never a requirement. Export still works.
      if (window.console) console.warn('Ganty: autosave unavailable -', err.message);
    }
  }, 400);

  /** bypass the debounce - used on the way out of the page */
  function saveNow() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)); }
    catch (err) { /* nothing we can do, and nothing worth interrupting for */ }
  }

  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      // fall back to the pre-rename key, then write forward. The old
      // entry is left alone as a backup rather than deleted.
      if (raw == null) raw = localStorage.getItem(LEGACY_KEY);
    } catch (err) { /* ignore */ }
    if (raw) {
      try { doc = normalize(JSON.parse(raw)); saveNow(); return 'restored'; }
      catch (err) { /* fall through to a fresh document */ }
    }
    doc = sampleDoc();
    return 'sample';
  }

  function replace(raw, keepHistory) {
    if (!keepHistory) { undoStack.length = 0; redoStack.length = 0; }
    else snapshot();
    doc = normalize(raw);
    selection = null;
    emit('replace');
  }

  function clearAll() {
    snapshot();
    doc.groups = [];
    selection = null;
    emit('replace');
  }

  function getDoc() { return doc; }
  function setName(n) {
    if (doc.name === n) return;
    snapshot('name');
    doc.name = n;
    emit('name');
  }

  /* ---------------------------------------------------------- export */

  return {
    load: load, replace: replace, clearAll: clearAll,
    getDoc: getDoc, serialize: serialize, save: save, saveNow: saveNow,
    setName: setName,

    onChange: onChange, emit: emit,

    snapshot: snapshot, endGesture: endGesture,
    undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo,

    groups: groups, findGroup: findGroup, findTask: findTask,
    parentOf: parentOf, find: find,
    groupSpan: groupSpan, docSpan: docSpan, visibleRows: visibleRows,

    addGroup: addGroup, addTask: addTask, removeById: removeById,
    duplicate: duplicate, rename: rename,
    setColor: setColor, resetTaskColors: resetTaskColors,
    toggleCollapse: toggleCollapse, collapseAll: collapseAll,
    setDates: setDates, shiftAll: shiftAll, startToday: startToday,
    minLen: minLen, reorder: reorder,

    view: view, setView: setView, setRange: setRange,
    growRangeToFit: growRangeToFit, fitRangeToContent: fitRangeToContent,
    MIN_DAYS: MIN_DAYS,

    getSelection: getSelection, select: select
  };
})();
