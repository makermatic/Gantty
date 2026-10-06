/* ============================================================
   main.js - boot, toolbar, menus, dialogs, keyboard
   ============================================================ */

(function () {
  var U = G.util, S = G.state, T = G.timeline, R = G.render, X = G.exporters;

  /* ==========================================================
     UI chrome (menus, context menu, dialogs)
     ========================================================== */

  var ui = G.ui = {};

  function openMenu(node) {
    closeMenus(node);
    node.hidden = false;
  }
  function closeMenus(except) {
    U.$$('.menu').forEach(function (m) { if (m !== except) m.hidden = true; });
    var ctx = U.$('#ctx');
    if (ctx) ctx.hidden = true;
  }
  ui.closeMenus = closeMenus;

  /* ---- colour picker ---------------------------------------------- */

  function swatchGrid(onPick, colors, current) {
    var wrap = U.el('div', 'ctx-swatches');
    (colors || U.PALETTE).forEach(function (c) {
      var i = U.el('i');
      i.style.background = c;
      i.title = c;
      if (current && c === current) i.classList.add('on');
      i.addEventListener('click', function () { onPick(c); closeMenus(); });
      wrap.appendChild(i);
    });
    return wrap;
  }

  /**
   * The full colour picker: presets, whatever custom colours this
   * browser has used before, and a native picker with a hex field.
   *
   * Live edits share one undo tag so dragging around the OS colour
   * wheel leaves a single entry in the history, not two hundred.
   */
  function colorPicker(id, current) {
    var wrap = U.el('div', 'picker');
    var tag = 'color:' + id + ':' + Date.now();

    function apply(c, live) {
      var col = U.normalizeHex(c);
      if (!col) return;
      S.setColor(id, col, live ? tag : null);
      if (!live) U.rememberColor(col);
    }

    wrap.appendChild(swatchGrid(function (c) { apply(c); }, U.PALETTE, current));

    var recents = U.recentColors();
    if (recents.length) {
      wrap.appendChild(U.el('div', 'ctx-sep'));
      wrap.appendChild(U.el('div', 'picker-label', 'Recent'));
      wrap.appendChild(swatchGrid(function (c) { apply(c); }, recents, current));
    }

    wrap.appendChild(U.el('div', 'ctx-sep'));

    var row = U.el('div', 'picker-custom');

    var native = U.el('input');
    native.type = 'color';
    native.value = current;
    native.title = 'Pick any colour';
    row.appendChild(native);

    var hex = U.el('input', 'picker-hex');
    hex.type = 'text';
    hex.value = current;
    hex.spellcheck = false;
    hex.setAttribute('aria-label', 'Hex colour');
    row.appendChild(hex);

    var ok = U.el('button', 'btn btn-primary picker-ok', 'Apply');
    row.appendChild(ok);

    // dragging the OS wheel streams `input` events - keep up live
    native.addEventListener('input', function () {
      hex.value = native.value;
      apply(native.value, true);
    });
    native.addEventListener('change', function () {
      S.endGesture();
      U.rememberColor(native.value);
    });

    hex.addEventListener('input', function () {
      var v = U.normalizeHex(hex.value);
      hex.classList.toggle('bad', !v && hex.value.trim() !== '');
      if (v) { native.value = v; apply(v, true); }
    });
    function commit() {
      var v = U.normalizeHex(hex.value);
      if (v) { apply(v); S.endGesture(); }
      closeMenus();
    }
    hex.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
    ok.addEventListener('click', commit);

    wrap.appendChild(row);
    return wrap;
  }

  function placeFloating(node, x, y) {
    node.hidden = false;
    var w = node.offsetWidth, h = node.offsetHeight;
    node.style.left = U.clamp(x, 6, window.innerWidth - w - 6) + 'px';
    node.style.top = U.clamp(y, 6, window.innerHeight - h - 6) + 'px';
  }

  ui.colorMenu = function (ev, id) {
    var item = S.find(id);
    if (!item) return;
    var ctx = U.$('#ctx');
    ctx.innerHTML = '';
    if (S.findGroup(id)) {
      ctx.appendChild(U.el('div', 'picker-label', 'Category colour — tasks follow along'));
    }
    ctx.appendChild(colorPicker(id, item.color));
    placeFloating(ctx, ev.clientX - 90, ev.clientY + 8);
  };

  /* ---- context menu ------------------------------------------------ */

  ui.contextMenu = function (ev, id, kind) {
    var ctx = U.$('#ctx');
    ctx.innerHTML = '';

    function item(label, fn, cls) {
      var b = U.el('button', cls || '', label);
      b.addEventListener('click', function () { closeMenus(); fn(); });
      ctx.appendChild(b);
    }
    function sep() { ctx.appendChild(U.el('div', 'ctx-sep')); }

    if (kind === 'group') {
      item('Add task', function () { S.addTask(id); });
      item('Rename', function () { focusName(id); });
      item('Duplicate category', function () { S.duplicate(id); });
      sep();
      item('Move category to today', function () {
        var g = S.findGroup(id), span = S.groupSpan(g);
        if (span) S.setDates(id, U.today(), U.today() + (span.end - span.start));
      });
      item('Collapse / expand', function () { S.toggleCollapse(id); });
      item('Reset task colours to category', function () { S.resetTaskColors(id); });
    } else {
      item('Edit dates…', function () { ui.editTask(id); });
      item('Rename', function () { focusName(id); });
      item('Duplicate task', function () { S.duplicate(id); });
      sep();
      item('Start today', function () {
        var t = S.findTask(id);
        S.setDates(id, U.today(), U.today() + (t.end - t.start));
      });
    }
    sep();
    ctx.appendChild(colorPicker(id, S.find(id).color));
    sep();
    item(kind === 'group' ? 'Delete category' : 'Delete task',
      function () { ui.confirmDelete(id); }, 'danger');

    placeFloating(ctx, ev.clientX, ev.clientY);
  };

  /**
   * Renders are queued on rAF, so anything that wants to touch a row
   * that was just created has to wait for the frame to land.
   */
  function afterRender(fn) {
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }

  function focusName(id) {
    var row = U.$('.row[data-id="' + id + '"]');
    if (!row) return;
    var n = U.$('.name', row);
    n.focus();
    var sel = window.getSelection(), rg = document.createRange();
    rg.selectNodeContents(n);
    sel.removeAllRanges();
    sel.addRange(rg);
  }

  /* ---- modal -------------------------------------------------------- */

  function modal(build) {
    var back = U.$('#modalBack'), box = U.$('#modal');
    box.innerHTML = '';
    build(box, close);
    back.hidden = false;
    function close() { back.hidden = true; box.innerHTML = ''; }
    back.onclick = function (e) { if (e.target === back) close(); };
    return close;
  }

  function buttons(box, close, okLabel, onOk, danger) {
    var row = U.el('div', 'row-btns');
    var cancel = U.el('button', 'btn', 'Cancel');
    cancel.onclick = close;
    var ok = U.el('button', 'btn ' + (danger ? '' : 'btn-primary'), okLabel);
    if (danger) {
      ok.style.background = 'var(--danger)';
      ok.style.borderColor = 'transparent';
      ok.style.color = '#fff';
      ok.style.fontWeight = '600';
    }
    ok.onclick = function () { onOk(); close(); };
    row.appendChild(cancel);
    row.appendChild(ok);
    box.appendChild(row);
    setTimeout(function () { ok.focus(); }, 0);
  }

  ui.confirm = function (title, message, okLabel, onOk) {
    modal(function (box, close) {
      box.appendChild(U.el('h3', '', title));
      box.appendChild(U.el('p', '', message));
      buttons(box, close, okLabel, onOk, true);
    });
  };

  ui.confirmDelete = function (id) {
    var g = S.findGroup(id);
    if (g && g.tasks.length) {
      var n = g.tasks.length;
      ui.confirm('Delete "' + g.name + '"?',
        'This also deletes its ' + n + (n === 1 ? ' task' : ' tasks') + '. Ctrl+Z undoes it.',
        'Delete', function () { S.removeById(id); });
      return;
    }
    S.removeById(id);
  };

  ui.editTask = function (id) {
    var t = S.findTask(id);
    if (!t) return;
    var chosen = t.color;

    modal(function (box, close) {
      box.appendChild(U.el('h3', '', 'Edit task'));
      var frm = U.el('div', 'frm');

      function field(label, node) {
        frm.appendChild(U.el('label', '', label));
        frm.appendChild(node);
        return node;
      }
      var name = U.el('input');
      name.type = 'text'; name.value = t.name;
      field('Name', name);

      var s = U.el('input'); s.type = 'date';
      s.value = U.toISO(T.containing(t.start));
      field('Start', s);

      var e = U.el('input'); e.type = 'date';
      e.value = U.toISO(T.containing(t.end - 1e-6));
      field('End', e);

      var sw = swatchGrid(function (c) { chosen = c; native.value = c; paint(); });
      sw.style.padding = '0';
      var swWrap = U.el('div');
      swWrap.appendChild(sw);

      var native = U.el('input');
      native.type = 'color';
      native.value = chosen;
      native.title = 'Pick any colour';
      native.style.marginTop = '8px';
      native.addEventListener('input', function () { chosen = native.value; paint(); });
      swWrap.appendChild(native);

      field('Colour', swWrap);

      function paint() {
        U.$$('i', sw).forEach(function (i) {
          i.classList.toggle('on', i.title === chosen);
        });
      }
      paint();

      box.appendChild(frm);
      buttons(box, close, 'Save', function () {
        S.rename(id, name.value.trim() || t.name);
        if (chosen !== t.color) { S.setColor(id, chosen); U.rememberColor(chosen); }
        if (s.value && e.value) {
          var ds = U.toDay(s.value), de = U.toDay(e.value) + 1;   // end is inclusive in the UI
          S.setDates(id, ds, Math.max(de, ds + S.minLen()));
        }
      });
      setTimeout(function () { name.focus(); name.select(); }, 0);
    });
  };

  /* ==========================================================
     Re-render on change
     ========================================================== */

  var pending = false;

  S.onChange(function (reason) {
    S.save();

    // Selection is a class flip, not a rebuild - rebuilding here would
    // destroy the very bar a drag gesture is holding on to.
    if (reason === 'select') { R.updateSelection(); syncStatus(); return; }

    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      R.render();
      syncChrome();
    });
  });

  function syncChrome() {
    U.$('#btnUndo').disabled = !S.canUndo();
    U.$('#btnRedo').disabled = !S.canRedo();
    var v = S.view();
    U.$('#zoom').value = v.dayWidth;
    var zoomField = U.$('#zoomVal');
    if (document.activeElement !== zoomField) zoomField.value = v.dayWidth;
    var nameField = U.$('#projectName');
    if (document.activeElement !== nameField) nameField.value = S.getDoc().name;
    syncStatus();
  }

  function syncStatus() {
    var d = S.getDoc(), v = S.view();
    var tasks = 0;
    d.groups.forEach(function (g) { tasks += g.tasks.length; });
    var span = S.docSpan();
    var parts = [
      d.groups.length + (d.groups.length === 1 ? ' category' : ' categories'),
      tasks + (tasks === 1 ? ' task' : ' tasks'),
      U.longLabel(v.origin) + ' → ' + U.longLabel(v.origin + v.days - 1) +
        ' (' + U.durationLabel(v.days) + ')'
    ];
    if (span) {
      parts.push('schedule spans ' + U.durationLabel(Math.round(span.end - span.start)));
    }
    U.$('#statusLeft').textContent = parts.join('  ·  ');
  }

  /* ==========================================================
     Toolbar
     ========================================================== */

  function wireToolbar() {
    U.$('#btnAddGroup').onclick = function () {
      var g = S.addGroup();
      afterRender(function () { focusName(g.id); });
    };
    U.$('#btnFirstGroup').onclick = U.$('#btnAddGroup').onclick;
    U.$('#btnHeadAddGroup').onclick = U.$('#btnAddGroup').onclick;

    U.$('#btnAddTask').onclick = function () { addTaskToSelection(); };

    U.$('#btnToday').onclick = function () {
      S.growRangeToFit(U.today(), U.today() + 1);
      R.render();
      T.scrollToDay(U.today() - 1);
      S.save();
    };

    U.$('#btnStartToday').onclick = function () {
      if (!S.startToday()) {
        flash('Nothing to move yet — add a task first.');
        return;
      }
      S.fitRangeToContent();
      R.render();
      T.scrollToDay(U.today() - 3);
    };

    U.$('#btnFit').onclick = function () {
      if (!S.fitRangeToContent()) { flash('Nothing to fit yet.'); return; }
      var sc = T.scrollEl();
      var avail = sc.clientWidth - T.sidebarWidth() - 40;
      S.setView({ dayWidth: U.clamp(Math.floor(avail / S.view().days), 3, 80) });
      R.render();
      sc.scrollLeft = 0;
    };

    U.$('#btnZoomIn').onclick = function () { G.interact.zoomBy(1); };
    U.$('#btnZoomOut').onclick = function () { G.interact.zoomBy(-1); };
    U.$('#zoom').oninput = function () { G.interact.zoomTo(+this.value); };

    // ---- typed zoom
    var zoomField = U.$('#zoomVal');
    function commitZoom() {
      var v = parseInt(zoomField.value, 10);
      if (!isFinite(v)) { zoomField.value = S.view().dayWidth; return; }
      // zoomTo clamps; echo back what it actually settled on so an
      // out-of-range entry corrects itself in front of you
      zoomField.value = G.interact.zoomTo(v) || S.view().dayWidth;
    }
    zoomField.addEventListener('change', commitZoom);
    zoomField.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitZoom(); zoomField.blur(); }
      if (e.key === 'Escape') { zoomField.value = S.view().dayWidth; zoomField.blur(); }
    });

    U.$('#btnUndo').onclick = function () { S.undo(); };
    U.$('#btnRedo').onclick = function () { S.redo(); };

    U.$('#btnCollapseAll').onclick = function () {
      var anyOpen = S.groups().some(function (g) { return !g.collapsed; });
      S.collapseAll(anyOpen);
    };

    // ---- project name
    var nameField = U.$('#projectName');
    nameField.addEventListener('change', function () { S.setName(this.value.trim() || 'Untitled Schedule'); });
    nameField.addEventListener('blur', function () { S.setName(this.value.trim() || 'Untitled Schedule'); });

    // ---- export menu
    var menuExport = U.$('#menuExport');
    U.$('#btnExport').onclick = function (e) {
      e.stopPropagation();
      menuExport.hidden ? openMenu(menuExport) : closeMenus();
    };
    menuExport.addEventListener('click', function (e) {
      var act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      closeMenus();
      if (act === 'png') { flash('Rendering PNG…'); X.toPNG().then(function () { flash('PNG saved.'); }); }
      else if (act === 'svg') { X.toSVG(); flash('SVG saved.'); }
      else if (act === 'pdf') { X.toPDF(); }
      else if (act === 'json') { X.toJSON(); flash('Project file saved.'); }
      else if (act === 'csv') { X.toCSV(); flash('CSV saved.'); }
    });

    // ---- open
    var fileInput = U.$('#fileInput');
    U.$('#btnImport').onclick = function () { fileInput.click(); };
    fileInput.addEventListener('change', function () {
      if (!this.files || !this.files[0]) return;
      var f = this.files[0];
      X.importFile(f, function (err) {
        if (err) flash('Could not open that file — ' + err.message);
        else flash('Opened ' + f.name);
      });
      this.value = '';
    });

    // ---- settings menu
    var menuSettings = U.$('#menuSettings');
    U.$('#btnSettings').onclick = function (e) {
      e.stopPropagation();
      menuSettings.hidden ? openMenu(menuSettings) : closeMenus();
    };
    var toggles = {
      optWeekends: 'weekends', optWeekNums: 'weekNums',
      optToday: 'todayMarker', optLabels: 'barLabels', optFree: 'freeDrag'
    };
    Object.keys(toggles).forEach(function (k) {
      var box = U.$('#' + k);
      box.addEventListener('change', function () {
        var patch = {};
        patch[toggles[k]] = box.checked;
        S.setView(patch);
      });
    });
    menuSettings.addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.act === 'clear') {
        closeMenus();
        ui.confirm('Clear the schedule?',
          'Every category and task is removed. You can still undo with Ctrl+Z.',
          'Clear', function () { S.clearAll(); });
      }
    });

    document.addEventListener('pointerdown', function (e) {
      if (!e.target.closest || !e.target.closest('.menu, .menu-wrap, .ctx')) closeMenus();
    });
  }

  function syncSettingsBoxes() {
    var v = S.view();
    U.$('#optWeekends').checked = v.weekends;
    U.$('#optWeekNums').checked = v.weekNums;
    U.$('#optToday').checked = v.todayMarker;
    U.$('#optLabels').checked = v.barLabels;
    U.$('#optFree').checked = v.freeDrag;
  }

  function addTaskToSelection() {
    var sel = S.getSelection();
    var gid = null;
    if (sel) gid = (sel.kind === 'group') ? sel.id : (S.parentOf(sel.id) || {}).id;
    if (!gid && S.groups().length) gid = S.groups()[S.groups().length - 1].id;
    if (!gid) { flash('Create a category first.'); return; }
    var t = S.addTask(gid);
    if (t) afterRender(function () { focusName(t.id); });
  }

  /* ---- transient status message ------------------------------------ */

  var flashTimer = null;
  function flash(msg) {
    var el = U.$('#statusRight');
    el.textContent = msg;
    el.style.color = 'var(--accent)';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      el.style.color = '';
      el.textContent = 'Drag a bar to move · drag its edges to resize · drag empty space to create';
    }, 2600);
  }

  /* ==========================================================
     Inline renaming in the sidebar
     ========================================================== */

  function wireNames() {
    var rows = U.$('#rows');

    rows.addEventListener('keydown', function (e) {
      var n = e.target;
      if (!n.dataset || n.dataset.role !== 'name') return;
      if (e.key === 'Enter') { e.preventDefault(); n.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        var row = n.closest('.row');
        var item = S.find(row.dataset.id);
        if (item) n.textContent = item.name;
        n.blur();
      }
      e.stopPropagation();                 // keep app shortcuts out of the field
    });

    rows.addEventListener('focusout', function (e) {
      var n = e.target;
      if (!n.dataset || n.dataset.role !== 'name') return;
      var row = n.closest('.row');
      if (!row) return;
      var text = n.textContent.replace(/\s+/g, ' ').trim();
      if (!text) {
        var item = S.find(row.dataset.id);
        n.textContent = item ? item.name : '';
        return;
      }
      S.rename(row.dataset.id, text);
    });
  }

  /* ==========================================================
     Keyboard
     ========================================================== */

  function editing(el) {
    return el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  function wireKeys() {
    window.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
        closeMenus();
        if (!U.$('#modalBack').hidden) U.$('#modalBack').hidden = true;
        return;
      }
      if (editing(document.activeElement)) return;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? S.redo() : S.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); S.redo(); return; }
      if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); U.$('#btnAddGroup').onclick(); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); addTaskToSelection(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); X.toJSON(); flash('Project file saved.'); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); U.$('#fileInput').click(); return; }
      if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); X.toPDF(); return; }

      var sel = S.getSelection();

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel) { e.preventDefault(); ui.confirmDelete(sel.id); }
        return;
      }
      if (e.key === 't' || e.key === 'T') { U.$('#btnToday').onclick(); return; }
      if (e.key === '+' || e.key === '=') { G.interact.zoomBy(1); return; }
      if (e.key === '-' || e.key === '_') { G.interact.zoomBy(-1); return; }

      if (sel && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        var step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.altKey ? 7 : 1);
        nudge(sel, step, e.shiftKey);
      }
    });

    // a run of arrow presses is one undo step; releasing the key ends it
    window.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') S.endGesture();
    });
  }

  /** arrow keys: move the selection, or shift+arrow to stretch its end */
  function nudge(sel, step, stretch) {
    if (sel.kind === 'task') {
      var t = S.findTask(sel.id);
      if (!t) return;
      if (stretch) S.setDates(sel.id, t.start, Math.max(t.end + step, t.start + S.minLen()), 'key');
      else S.setDates(sel.id, t.start + step, t.end + step, 'key');
    } else {
      var g = S.findGroup(sel.id), span = S.groupSpan(g);
      if (!span) return;
      S.setDates(sel.id, span.start + step, span.end + step, 'key');
    }
  }

  /* ==========================================================
     Boot
     ========================================================== */

  function boot() {
    var how = S.load();
    R.init();
    U.cssVar('--day-w', T.dayWidth() + 'px');
    R.render();
    G.interact.init();
    wireToolbar();
    wireNames();
    wireKeys();
    syncSettingsBoxes();
    syncChrome();

    // open on today when there is nothing else to look at
    var span = S.docSpan();
    T.scrollToDay(span ? Math.floor(span.start) - 2 : U.today() - 3);

    if (how === 'sample') {
      flash('Sample schedule loaded — edit it, or clear it from the gear menu.');
    }

    window.addEventListener('resize', U.debounce(function () {
      R.positionRangeHandles();
      R.positionSideResizer();
    }, 120));

    // last-chance save if the debounce has not fired yet
    window.addEventListener('beforeunload', function () { S.saveNow(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
