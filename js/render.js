/* ============================================================
   render.js - turns the document into DOM

   A full re-render is cheap at these sizes, so most changes just call
   render().  Dragging is the exception: it writes straight to the one
   bar's inline style (see interact.js) and only re-renders on release.
   ============================================================ */

G.render = (function () {
  var U = G.util, S = G.state, T = G.timeline;

  var elCanvas, elRows, elHeadTrack, elMonths, elWeeks, elDays, elEmpty, elHeader;
  var handleL, handleR;

  function init() {
    elCanvas    = U.$('#canvas');
    elRows      = U.$('#rows');
    elHeader    = U.$('#header');
    elHeadTrack = U.$('#headTrack');
    elMonths    = U.$('#headMonths');
    elWeeks     = U.$('#headWeeks');
    elDays      = U.$('#headDays');
    elEmpty     = U.$('#empty');
    buildRangeHandles();
  }

  /* ---------------------------------------------------------- grid paint

     The day grid, week rules and weekend shading are CSS gradients
     rather than thousands of divs.  Each layer is sized to exactly one
     repeat so the tiling is seamless, and the week-aligned layers are
     offset to the Monday on or before the range origin. */

  function gridStyle(target) {
    var dw = T.dayWidth(), wk = dw * 7;
    var offset = (U.weekStart(T.origin()) - T.origin()) * dw;   // <= 0
    var v = S.view();

    var images = [], sizes = [], positions = [];

    // week rules (topmost)
    images.push('linear-gradient(to right, var(--line-week) 0 1px, transparent 1px)');
    sizes.push(wk + 'px 100%');
    positions.push(offset + 'px 0');

    // day rules - dropped once they would be denser than they are useful
    if (dw >= 7) {
      images.push('linear-gradient(to right, var(--line) 0 1px, transparent 1px)');
      sizes.push(dw + 'px 100%');
      positions.push('0 0');
    }

    // weekend shading (Mon-based week: Sat is slot 5, Sun slot 6)
    if (v.weekends) {
      images.push('linear-gradient(to right, transparent 0 ' + (dw * 5) +
                  'px, var(--weekend) ' + (dw * 5) + 'px ' + wk + 'px)');
      sizes.push(wk + 'px 100%');
      positions.push(offset + 'px 0');
    }

    target.style.backgroundImage = images.join(',');
    target.style.backgroundSize = sizes.join(',');
    target.style.backgroundPosition = positions.join(',');
    target.style.backgroundRepeat = 'repeat';
  }

  /* ---------------------------------------------------------- header */

  function renderHeader() {
    var w = T.trackWidth();
    elHeadTrack.style.width = w + 'px';
    elMonths.innerHTML = elWeeks.innerHTML = elDays.innerHTML = '';

    var dens = T.density();
    var v = S.view();

    // ---- months
    T.months().forEach(function (m) {
      var n = U.el('div', 'mo', m.label);
      n.style.left = m.x + 'px';
      n.style.width = m.w + 'px';
      elMonths.appendChild(n);
    });

    // ---- week numbers
    if (v.weekNums) {
      var minW = 16;
      T.weeks().forEach(function (wk) {
        if (wk.w < minW) return;
        var n = U.el('div', 'wk', wk.label);
        n.style.left = wk.x + 'px';
        n.style.width = wk.w + 'px';
        elWeeks.appendChild(n);
      });
    }

    // ---- day numbers
    gridStyle(elDays);
    if (dens !== 'month') {
      var today = U.today();
      T.dayCells().forEach(function (c) {
        if (dens === 'week' && !c.weekStart) return;
        var n = U.el('div', 'dy' + (c.weekend ? ' wknd' : '') + (c.today ? ' is-today' : ''), c.label);
        n.style.left = c.x + 'px';
        n.style.width = (dens === 'week' ? c.w * 7 : c.w) + 'px';
        n.title = U.longLabel(c.day);
        elDays.appendChild(n);
      });
    }
  }

  /* ---------------------------------------------------------- rows */

  var CHEVRON =
    '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
    '<path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderRows() {
    var rows = S.visibleRows();
    var sel = S.getSelection();
    var tw = T.trackWidth();
    var v = S.view();
    var today = U.today();
    var showToday = v.todayMarker && today >= T.origin() && today < T.origin() + T.days();

    elRows.innerHTML = '';
    elEmpty.hidden = rows.length > 0;

    rows.forEach(function (r) {
      var isGroup = r.kind === 'group';
      var node = U.el('div', 'row ' + (isGroup ? 'group' : 'task') +
        (isGroup && !r.group.collapsed ? ' open' : '') +
        (sel && sel.id === r.id ? ' selected' : ''));
      node.dataset.id = r.id;
      node.dataset.kind = r.kind;

      node.appendChild(buildLabel(r, isGroup));

      // ---- track
      var track = U.el('div', 'row-track');
      track.style.width = tw + 'px';
      track.dataset.id = r.id;
      track.dataset.kind = r.kind;
      gridStyle(track);

      if (showToday) {
        var tc = U.el('div', 'today-col');
        tc.style.left = T.x(today) + 'px';
        track.appendChild(tc);
      }

      if (isGroup) {
        var span = S.groupSpan(r.group);
        if (span) track.appendChild(buildBar(r.group, span.start, span.end, true, sel));
      } else {
        track.appendChild(buildBar(r.task, r.task.start, r.task.end, false, sel));
      }

      node.appendChild(track);
      elRows.appendChild(node);
    });

    positionRangeHandles();
    positionSideResizer();
  }

  function buildLabel(r, isGroup) {
    var label = U.el('div', 'row-label');

    var grip = U.el('div', 'grip');
    grip.title = 'Drag to reorder';
    grip.dataset.role = 'grip';
    label.appendChild(grip);

    var pill = U.el('div', 'pill');

    var tw = U.el('button', 'twisty' + (isGroup ? '' : ' leaf'));
    tw.innerHTML = CHEVRON;
    tw.dataset.role = 'twisty';
    tw.title = isGroup ? 'Show / hide tasks' : '';
    pill.appendChild(tw);

    // the visible mark stays a thin bar, but the button around it is a
    // proper click target rather than a 4px sliver
    var sw = U.el('button', 'swatch');
    sw.style.color = isGroup ? r.group.color : r.task.color;
    sw.appendChild(U.el('i'));
    sw.dataset.role = 'swatch';
    sw.title = isGroup ? 'Category colour' : 'Task colour';
    pill.appendChild(sw);

    var name = U.el('div', 'name', isGroup ? r.group.name : r.task.name);
    name.contentEditable = 'true';
    name.spellcheck = false;
    name.dataset.role = 'name';
    name.title = isGroup ? r.group.name : r.task.name;   // readable when truncated
    pill.appendChild(name);

    var acts = U.el('div', 'row-actions');
    if (isGroup) {
      var add = U.el('button', 'add', '+');
      add.title = 'Add a task to this category';
      add.dataset.role = 'add-task';
      acts.appendChild(add);
    }
    var del = U.el('button', 'del', '×');
    del.title = isGroup ? 'Delete category' : 'Delete task';
    del.dataset.role = 'delete';
    acts.appendChild(del);
    pill.appendChild(acts);

    label.appendChild(pill);
    return label;
  }

  function buildBar(item, start, end, isSummary, sel) {
    var bar = U.el('div', 'bar' + (isSummary ? ' summary' : '') +
      (sel && sel.id === item.id ? ' sel' : ''));
    bar.dataset.id = item.id;
    bar.dataset.kind = isSummary ? 'group' : 'task';
    placeBar(bar, start, end);
    bar.style.background = item.color;

    if (!isSummary) {
      bar.style.color = U.readableInk(item.color);
      if (S.view().barLabels) {
        var lab = U.el('span', 'bar-label', item.name);
        bar.appendChild(lab);
      }
      bar.appendChild(handleEl('l'));
      bar.appendChild(handleEl('r'));
      bar.title = barTitle(item, start, end);
    } else {
      bar.title = item.name + ' — ' + rangeText(start, end);
    }
    return bar;
  }

  function handleEl(side) {
    var h = U.el('div', 'hnd ' + side);
    h.dataset.role = 'resize';
    h.dataset.side = side;
    return h;
  }

  /** set a bar's left/width from day values - used by render AND by drag */
  function placeBar(bar, start, end) {
    bar.style.left = T.x(start) + 'px';
    bar.style.width = Math.max(3, (end - start) * T.dayWidth()) + 'px';
  }

  function rangeText(start, end) {
    var s = T.containing(start);
    var e = T.containing(end - 1e-6);
    var n = end - start;
    var len = (n === Math.round(n)) ? U.durationLabel(n) : (n.toFixed(2) + ' days');
    return U.longLabel(s) + '  →  ' + U.longLabel(e) + '   (' + len + ')';
  }
  function barTitle(item, start, end) {
    return item.name + '\n' + rangeText(start, end);
  }

  /* ---------------------------------------------- timeline range handles

     The Harmony-style grips that stretch how many days the timeline
     shows.  Dragging the right one adds or trims days at the end; the
     left one extends backwards in time. */

  function buildRangeHandles() {
    handleL = U.el('div', 'range-handle left');
    handleL.dataset.role = 'range';
    handleL.dataset.side = 'l';
    handleL.title = 'Drag to extend the timeline backwards';
    handleL.innerHTML = '<div class="knob"></div><div class="stem"></div>';

    handleR = U.el('div', 'range-handle right');
    handleR.dataset.role = 'range';
    handleR.dataset.side = 'r';
    handleR.title = 'Drag to add or remove days at the end of the timeline';
    handleR.innerHTML = '<div class="knob"></div><div class="stem"></div>';

    elCanvas.appendChild(handleL);
    elCanvas.appendChild(handleR);
  }

  function positionRangeHandles() {
    var side = T.sidebarWidth();
    var h = elHeader.offsetHeight + elRows.offsetHeight;
    [handleL, handleR].forEach(function (n) { n.style.height = Math.max(h, 200) + 'px'; });
    handleL.style.left = (side - 6) + 'px';
    handleR.style.left = (side + T.trackWidth() - 6) + 'px';
    updateHandleVisibility();
  }

  /** keep the fixed-position column resizer glued to the sidebar's edge */
  function positionSideResizer() {
    var el = U.$('#sideResizer');
    var sc = T.scrollEl();
    if (!el || !sc) return;
    var r = sc.getBoundingClientRect();
    el.style.left = (r.left + T.sidebarWidth() - 4) + 'px';
    el.style.top = r.top + 'px';
    el.style.height = r.height + 'px';
  }

  /**
   * Widest name currently rendered, plus the chrome around it - what the
   * column would need so nothing is truncated. Used by double-click.
   */
  function idealSidebarWidth() {
    var want = 0;
    U.$$('.row', elRows).forEach(function (row) {
      var name = U.$('.name', row);
      var label = U.$('.row-label', row);
      if (!name || !label) return;
      // everything in the row that is not the text itself
      var chrome = label.offsetWidth - name.offsetWidth;
      want = Math.max(want, name.scrollWidth + chrome + 8);
    });
    return want;
  }

  /** hide the left grip once it has scrolled underneath the sticky sidebar */
  function updateHandleVisibility() {
    var sc = T.scrollEl();
    if (!sc || !handleL) return;
    handleL.style.visibility = (sc.scrollLeft > 4) ? 'hidden' : 'visible';
  }

  /* ------------------------------------------------------- selection only

     Selecting must never rebuild the DOM: a drag gesture selects on
     pointerdown and is holding a reference to the very bar that a
     rebuild would throw away. */

  function updateSelection() {
    var sel = S.getSelection();
    U.$$('.row', elRows).forEach(function (n) {
      n.classList.toggle('selected', !!sel && n.dataset.id === sel.id);
    });
    U.$$('.bar', elRows).forEach(function (n) {
      n.classList.toggle('sel', !!sel && n.dataset.id === sel.id);
    });
  }

  /* ---------------------------------------------------------- top level */

  function render() {
    var v = S.view();
    U.cssVar('--day-w', T.dayWidth() + 'px');
    U.cssVar('--side-w', v.sideWidth + 'px');
    // turning week numbers off should give the space back, not leave a gap
    U.cssVar('--head-weeks', v.weekNums ? '20px' : '0px');
    renderHeader();
    renderRows();
  }

  return {
    init: init, render: render, updateSelection: updateSelection,
    renderHeader: renderHeader, renderRows: renderRows,
    placeBar: placeBar, rangeText: rangeText, barTitle: barTitle,
    positionRangeHandles: positionRangeHandles,
    positionSideResizer: positionSideResizer, idealSidebarWidth: idealSidebarWidth,
    updateHandleVisibility: updateHandleVisibility,
    gridStyle: gridStyle
  };
})();
