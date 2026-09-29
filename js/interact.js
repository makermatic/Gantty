/* ============================================================
   interact.js - all pointer gestures on the chart

   THE FEEL
   --------
   While you drag, the bar follows the cursor pixel-for-pixel - no
   stepping, no lag, nothing jumping to a grid.  A tooltip shows the
   dates it will land on.  Only when you let go does it settle onto
   whole days.  That is what makes Kitsu feel loose while the numbers
   underneath stay clean.

   Turn on "Free positioning" and the landing grid drops to quarter
   days instead of whole ones.

   GESTURES
   --------
   bar body       move
   bar edge       resize that end
   empty track    draw a new bar
   grip           reorder rows
   range knob     stretch how many days the timeline shows
   ctrl+wheel     zoom about the cursor
   shift+wheel    pan sideways
   ============================================================ */

G.interact = (function () {
  var U = G.util, S = G.state, T = G.timeline, R = G.render;

  var drag = null;               // the gesture in flight, or null
  var EDGE = 48;                 // px from the edge where auto-scroll kicks in
  var EDGE_SPEED = 22;           // px per frame at full tilt
  var THRESHOLD = 3;             // px before a press becomes a drag

  function init() {
    var sc = T.scrollEl();
    sc.addEventListener('pointerdown', onPointerDown);
    sc.addEventListener('dblclick', onDblClick);
    sc.addEventListener('contextmenu', onContextMenu);
    sc.addEventListener('wheel', onWheel, { passive: false });
    sc.addEventListener('scroll', function () { R.updateHandleVisibility(); });

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  /* ---------------------------------------------------------- helpers */

  function roleOf(node) {
    var n = node;
    while (n && n !== document) {
      if (n.dataset && n.dataset.role) return { role: n.dataset.role, el: n };
      n = n.parentNode;
    }
    return null;
  }
  function closest(node, cls) {
    var n = node;
    while (n && n !== document) {
      if (n.classList && n.classList.contains(cls)) return n;
      n = n.parentNode;
    }
    return null;
  }

  /** total horizontal movement, including anything auto-scroll added */
  function dx() {
    var sc = T.scrollEl();
    return (drag.clientX - drag.startX) + (sc.scrollLeft - drag.startScroll);
  }

  function showTip(text) {
    var tip = U.$('#tip');
    tip.innerHTML = text;
    tip.hidden = false;
    var x = drag ? drag.clientX : 0, y = drag ? drag.clientY : 0;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = U.clamp(x + 14, 6, window.innerWidth - w - 6) + 'px';
    tip.style.top = U.clamp(y - h - 14, 6, window.innerHeight - h - 6) + 'px';
  }
  function hideTip() { U.$('#tip').hidden = true; }

  function dateTip(start, end) {
    var s = T.snap(start), e = T.snap(end);
    var n = e - s;
    return '<b>' + U.longLabel(T.containing(s)) + '</b> &rarr; <b>' +
           U.longLabel(T.containing(e - 1e-6)) + '</b><br>' +
           (n === Math.round(n) ? U.durationLabel(n) : n.toFixed(2) + ' days');
  }

  /* ---------------------------------------------------------- pointer down */

  function onPointerDown(ev) {
    if (ev.button !== 0) return;
    G.ui.closeMenus();

    var r = roleOf(ev.target);

    /* ---- sidebar widgets are plain clicks, not gestures */
    if (r) {
      switch (r.role) {
        case 'twisty':
          S.toggleCollapse(closest(r.el, 'row').dataset.id);
          ev.preventDefault();
          return;
        case 'swatch':
          ev.preventDefault();
          G.ui.colorMenu(ev, closest(r.el, 'row').dataset.id);
          return;
        case 'add-task':
          ev.preventDefault();
          S.addTask(closest(r.el, 'row').dataset.id);
          return;
        case 'delete':
          ev.preventDefault();
          G.ui.confirmDelete(closest(r.el, 'row').dataset.id);
          return;
        case 'name':
          S.select(closest(r.el, 'row').dataset.kind, closest(r.el, 'row').dataset.id);
          return;                                     // let the caret land
        case 'grip':
          startReorder(ev, closest(r.el, 'row'));
          return;
        case 'range':
          startRangeDrag(ev, r.el);
          return;
        case 'resize':
          startBarDrag(ev, closest(r.el, 'bar'), r.el.dataset.side);
          return;
      }
    }

    var bar = closest(ev.target, 'bar');
    if (bar) { startBarDrag(ev, bar, 'move'); return; }

    var track = closest(ev.target, 'row-track');
    if (track) { startCreate(ev, track); return; }

    var label = closest(ev.target, 'row-label');
    if (label) {
      var row = closest(label, 'row');
      S.select(row.dataset.kind, row.dataset.id);
    }
  }

  /* ------------------------------------------------- gesture: move/resize */

  function startBarDrag(ev, bar, mode) {
    var id = bar.dataset.id;
    var kind = bar.dataset.kind;
    var item, start, end;

    if (kind === 'group') {
      var g = S.findGroup(id);
      var span = S.groupSpan(g);
      if (!span) return;
      item = g; start = span.start; end = span.end;
      mode = 'move';                                  // summaries only move
    } else {
      item = S.findTask(id);
      if (!item) return;
      start = item.start; end = item.end;
    }

    S.select(kind, id);

    drag = {
      type: 'bar', mode: mode, id: id, kind: kind,
      bar: bar, origStart: start, origEnd: end,
      startX: ev.clientX, clientX: ev.clientX, clientY: ev.clientY,
      startScroll: T.scrollEl().scrollLeft,
      moved: false, tag: 'drag:' + id + ':' + Date.now()
    };
    bar.setPointerCapture && bar.setPointerCapture(ev.pointerId);
    document.body.classList.add(mode === 'move' ? 'dragging' : 'resizing');
    ev.preventDefault();
    startEdgeScroll();
  }

  /** current unsnapped start/end for the bar gesture */
  function barPreview() {
    var d = T.pxToDays(dx());
    var s = drag.origStart, e = drag.origEnd;
    var min = S.minLen();

    if (drag.mode === 'move') { s += d; e += d; }
    else if (drag.mode === 'l') { s = Math.min(s + d, e - min); }
    else { e = Math.max(e + d, s + min); }
    return { start: s, end: e };
  }

  /* ------------------------------------------------- gesture: create */

  function startCreate(ev, track) {
    var kind = track.dataset.kind;
    var id = track.dataset.id;
    var groupId = (kind === 'group') ? id : (S.parentOf(id) || {}).id;
    if (!groupId) return;

    var d = T.dayFromEvent(ev, track);
    drag = {
      type: 'create', groupId: groupId, track: track,
      anchor: d, startX: ev.clientX, clientX: ev.clientX, clientY: ev.clientY,
      startScroll: T.scrollEl().scrollLeft, moved: false,
      ghost: null
    };
    document.body.classList.add('resizing');
    ev.preventDefault();
    startEdgeScroll();
  }

  function createPreview() {
    var a = drag.anchor, b = drag.anchor + T.pxToDays(dx());
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  /* ------------------------------------------------- gesture: range grips */

  function startRangeDrag(ev, el) {
    var v = S.view();
    drag = {
      type: 'range', side: el.dataset.side, el: el,
      origOrigin: v.origin, origDays: v.days,
      startX: ev.clientX, clientX: ev.clientX, clientY: ev.clientY,
      startScroll: T.scrollEl().scrollLeft, moved: false
    };
    el.classList.add('active');
    document.body.classList.add('resizing');
    ev.preventDefault();
    startEdgeScroll();
  }

  /**
   * Work out the range the grip is currently asking for.
   * Trimming is clamped so it can never swallow an existing bar - losing
   * work off the end of the timeline would be a nasty surprise.
   */
  function rangePreview() {
    var d = Math.round(T.pxToDays(dx()));
    var span = S.docSpan();
    var o = drag.origOrigin, n = drag.origDays;

    if (drag.side === 'r') {
      var days = Math.max(S.MIN_DAYS, n + d);
      if (span) days = Math.max(days, Math.ceil(span.end) - o);
      return { origin: o, days: days };
    }
    var origin = o + d;
    if (span) origin = Math.min(origin, Math.floor(span.start));
    origin = Math.min(origin, o + n - S.MIN_DAYS);
    return { origin: origin, days: n + (o - origin) };
  }

  /* ------------------------------------------------- gesture: reorder */

  function startReorder(ev, row) {
    drag = {
      type: 'reorder', id: row.dataset.id, kind: row.dataset.kind,
      row: row, startX: ev.clientX, startY: ev.clientY,
      clientX: ev.clientX, clientY: ev.clientY,
      startScroll: T.scrollEl().scrollLeft,
      moved: false, target: null, before: true,
      line: null
    };
    document.body.classList.add('dragging');
    ev.preventDefault();
  }

  function updateReorder() {
    var rows = U.$$('.row', U.$('#rows'));
    var best = null, before = true;

    for (var i = 0; i < rows.length; i++) {
      var rc = rows[i].getBoundingClientRect();
      if (drag.clientY < rc.top + rc.height / 2) { best = rows[i]; before = true; break; }
      best = rows[i]; before = false;
    }
    if (!best) return;

    // a task cannot be dropped inside itself, a category cannot move into one
    if (best.dataset.id === drag.id) { hideLine(); drag.target = null; return; }
    if (drag.kind === 'group' && best.dataset.kind === 'task') {
      var owner = S.parentOf(best.dataset.id);
      if (owner && owner.id === drag.id) { hideLine(); drag.target = null; return; }
    }

    drag.target = best.dataset.id;
    drag.before = before;

    var line = drag.line;
    if (!line) {
      line = drag.line = U.el('div', 'reorder-line');
      U.$('#canvas').appendChild(line);
    }
    var cr = U.$('#canvas').getBoundingClientRect();
    var br = best.getBoundingClientRect();
    line.style.top = ((before ? br.top : br.bottom) - cr.top) + 'px';
    line.style.left = '0px';
    line.style.width = (T.sidebarWidth() + T.trackWidth()) + 'px';
    line.style.display = 'block';
  }
  function hideLine() { if (drag && drag.line) drag.line.style.display = 'none'; }

  /* ---------------------------------------------------------- move */

  function onPointerMove(ev) {
    if (!drag) return;
    drag.clientX = ev.clientX;
    drag.clientY = ev.clientY;
    apply();
  }

  /** redraw whatever the in-flight gesture is showing */
  function apply() {
    if (!drag) return;

    if (!drag.moved) {
      var travel = Math.abs(drag.clientX - drag.startX) +
                   Math.abs(drag.clientY - (drag.startY == null ? drag.clientY : drag.startY));
      if (travel < THRESHOLD) return;
      drag.moved = true;
    }

    if (drag.type === 'bar') {
      var p = barPreview();
      R.placeBar(drag.bar, p.start, p.end);
      drag.bar.classList.add('dragging');
      showTip(dateTip(p.start, p.end));

    } else if (drag.type === 'create') {
      var c = createPreview();
      if (!drag.ghost) {
        drag.ghost = U.el('div', 'ghost-bar');
        drag.track.appendChild(drag.ghost);
      }
      R.placeBar(drag.ghost, c.start, c.end);
      showTip(dateTip(c.start, c.end));

    } else if (drag.type === 'range') {
      var r = rangePreview();
      S.setRange(r.origin, r.days);                   // emits -> re-render
      var last = r.origin + r.days;
      showTip((drag.side === 'r'
        ? 'Timeline ends <b>' + U.longLabel(last - 1) + '</b>'
        : 'Timeline starts <b>' + U.longLabel(r.origin) + '</b>') +
        '<br>' + U.durationLabel(r.days) + ' shown');

    } else if (drag.type === 'reorder') {
      drag.row.classList.add('drag-src');
      updateReorder();
    }
  }

  /* ---------------------------------------------------------- auto-scroll */

  var edgeRaf = null;

  function startEdgeScroll() {
    if (edgeRaf) return;
    var step = function () {
      if (!drag) { edgeRaf = null; return; }
      var sc = T.scrollEl();
      var rc = sc.getBoundingClientRect();
      var lo = rc.left + T.sidebarWidth();
      var hi = rc.right;
      var v = 0;
      if (drag.clientX < lo + EDGE) v = -(1 - (drag.clientX - lo) / EDGE);
      else if (drag.clientX > hi - EDGE) v = (1 - (hi - drag.clientX) / EDGE);
      if (v) {
        sc.scrollLeft += U.clamp(v, -1, 1) * EDGE_SPEED;
        apply();
      }
      edgeRaf = requestAnimationFrame(step);
    };
    edgeRaf = requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------- up */

  function onPointerUp() {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (edgeRaf) { cancelAnimationFrame(edgeRaf); edgeRaf = null; }
    document.body.classList.remove('dragging', 'resizing');
    hideTip();

    if (d.type === 'bar') {
      d.bar.classList.remove('dragging');
      if (d.moved) {
        var p = barPreviewFor(d);
        S.setDates(d.id, T.snap(p.start), T.snap(p.end), d.tag);
      } else {
        G.render.render();                            // just a click: repaint selection
      }

    } else if (d.type === 'create') {
      if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
      if (d.moved) {
        var c = createPreviewFor(d);
        var s = T.snap(c.start), e = T.snap(c.end);
        if (e - s < S.minLen()) e = s + S.minLen();
        S.addTask(d.groupId, { start: s, end: e });
      } else {
        // a bare click on empty track just selects the row
        var row = closest(d.track, 'row');
        if (row) S.select(row.dataset.kind, row.dataset.id);
      }

    } else if (d.type === 'range') {
      d.el.classList.remove('active');
      S.save();

    } else if (d.type === 'reorder') {
      d.row.classList.remove('drag-src');
      if (d.line && d.line.parentNode) d.line.parentNode.removeChild(d.line);
      if (d.moved && d.target) S.reorder(d.id, d.target, d.before);
      else G.render.render();
    }

    S.endGesture();
  }

  /* the preview helpers read the module-level `drag`; these let
     onPointerUp reuse them after it has been cleared */
  function barPreviewFor(d) { drag = d; var p = barPreview(); drag = null; return p; }
  function createPreviewFor(d) { drag = d; var c = createPreview(); drag = null; return c; }

  /* ---------------------------------------------------------- dbl / ctx */

  function onDblClick(ev) {
    var r = roleOf(ev.target);
    if (r && r.role === 'range') { S.fitRangeToContent(); return; }
    if (r && r.role === 'name') return;

    var bar = closest(ev.target, 'bar');
    if (bar) {
      if (bar.dataset.kind === 'task') G.ui.editTask(bar.dataset.id);
      else S.toggleCollapse(bar.dataset.id);
      return;
    }
    var track = closest(ev.target, 'row-track');
    if (track) {
      // double-click empty track -> a five-day task starting there
      var gid = track.dataset.kind === 'group'
        ? track.dataset.id
        : (S.parentOf(track.dataset.id) || {}).id;
      if (gid) {
        var d = Math.round(T.dayFromEvent(ev, track));
        S.addTask(gid, { start: d, end: d + 5 });
      }
    }
  }

  function onContextMenu(ev) {
    var bar = closest(ev.target, 'bar');
    var row = closest(ev.target, 'row');
    if (!bar && !row) return;
    ev.preventDefault();
    var id = bar ? bar.dataset.id : row.dataset.id;
    var kind = bar ? bar.dataset.kind : row.dataset.kind;
    S.select(kind, id);
    G.ui.contextMenu(ev, id, kind);
  }

  /* ---------------------------------------------------------- wheel */

  function onWheel(ev) {
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      zoomAt(ev.clientX, ev.deltaY < 0 ? 1 : -1);
    } else if (ev.shiftKey) {
      ev.preventDefault();
      T.scrollEl().scrollLeft += (ev.deltaY || ev.deltaX);
    }
  }

  /**
   * Zoom keeping the day under the cursor pinned in place - the thing
   * you are looking at stays where you are looking.
   */
  function zoomAt(clientX, dir) {
    var sc = T.scrollEl();
    var rc = sc.getBoundingClientRect();
    var side = T.sidebarWidth();
    var px = U.clamp(clientX - rc.left - side, 0, sc.clientWidth) + sc.scrollLeft;
    var anchorDay = T.day(px);

    var dw = T.dayWidth();
    var next = U.clamp(Math.round(dw * (dir > 0 ? 1.18 : 1 / 1.18)), 3, 80);
    if (next === dw) next = U.clamp(dw + dir, 3, 80);
    if (next === dw) return;

    S.setView({ dayWidth: next });
    // repaint before touching scrollLeft: the track has to be its new
    // width or the browser clamps the scroll position we are asking for
    R.render();
    sc.scrollLeft = Math.max(0, (anchorDay - T.origin()) * next - (clientX - rc.left - side));
  }

  function zoomBy(dir) {
    var sc = T.scrollEl();
    zoomAt(sc.getBoundingClientRect().left + T.sidebarWidth() + sc.clientWidth / 2, dir);
  }

  return { init: init, zoomAt: zoomAt, zoomBy: zoomBy };
})();
