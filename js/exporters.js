/* ============================================================
   exporters.js - PNG, SVG, PDF, JSON, CSV

   PNG and SVG are drawn from the same geometry the screen uses
   (G.timeline), not screenshotted, so they come out crisp at any
   size and never depend on a third-party library or a CDN.

   PDF goes through the browser's own print pipeline with the print
   stylesheet in css/app.css - that keeps the text as real, selectable
   vector text instead of a picture of text.
   ============================================================ */

G.exporters = (function () {
  var U = G.util, S = G.state, T = G.timeline;

  /* ---------------------------------------------------------- shared */

  var PAD = 16;                  // outer margin in the exported image
  var SIDE = 220;                // label column width in exports
  var ROW = 34;                  // row height in exports
  var BAR = 20;                  // task bar height
  var SUM = 9;                   // summary bar height
  var H_MONTH = 22, H_WEEK = 14, H_DAY = 18;
  function hWeek() { return S.view().weekNums ? H_WEEK : 0; }
  function head()  { return H_MONTH + hWeek() + H_DAY; }

  var INK = {
    bg: '#21242a', panel: '#2a2e36', track: '#3a3f4a', trackAlt: '#363b45',
    weekend: 'rgba(0,0,0,0.18)', line: 'rgba(255,255,255,0.06)',
    week: 'rgba(255,255,255,0.15)', text: '#e7eaef', muted: '#98a0ad',
    faint: '#6f7783', today: 'rgba(76,175,125,0.18)', todayEdge: 'rgba(76,175,125,0.55)'
  };
  var PAPER = {
    bg: '#ffffff', panel: '#ffffff', track: '#ffffff', trackAlt: '#f4f5f7',
    weekend: 'rgba(0,0,0,0.05)', line: 'rgba(0,0,0,0.10)',
    week: 'rgba(0,0,0,0.22)', text: '#111418', muted: '#555c66',
    faint: '#7b838d', today: 'rgba(76,175,125,0.18)', todayEdge: 'rgba(76,175,125,0.6)'
  };

  /**
   * Freeze everything an exporter needs into one plain object, using
   * an export-specific day width so the picture is readable regardless
   * of how far the user happens to be zoomed in on screen.
   */
  function layout(opts) {
    opts = opts || {};
    var v = S.view();
    var dw = opts.dayWidth || Math.max(12, Math.min(28, v.dayWidth));
    var origin = v.origin, days = v.days;

    var rows = S.visibleRows().map(function (r) {
      if (r.kind === 'group') {
        var span = S.groupSpan(r.group);
        return {
          kind: 'group', name: r.group.name, color: r.group.color,
          start: span ? span.start : null, end: span ? span.end : null
        };
      }
      return {
        kind: 'task', name: r.task.name, color: r.task.color,
        start: r.task.start, end: r.task.end
      };
    });

    var trackW = days * dw;
    return {
      dw: dw, origin: origin, days: days, rows: rows,
      trackW: trackW,
      width: PAD * 2 + SIDE + trackW,
      height: PAD * 2 + head() + rows.length * ROW + 28,     // + title strip
      title: S.getDoc().name,
      today: U.today(),
      view: v,
      x: function (d) { return (d - origin) * dw; }
    };
  }

  function fileName(ext) {
    var n = (S.getDoc().name || 'schedule').replace(/[^\w\- ]+/g, '').trim() || 'schedule';
    return n.replace(/\s+/g, '-').toLowerCase() + '-' + U.toISO(U.today()) + '.' + ext;
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ---------------------------------------------------------- PNG */

  function toPNG(opts) {
    opts = opts || {};
    var L = layout(opts);
    var C = opts.paper ? PAPER : INK;
    var scale = opts.scale || 2;

    var cv = document.createElement('canvas');
    cv.width = Math.ceil(L.width * scale);
    cv.height = Math.ceil(L.height * scale);
    var g = cv.getContext('2d');
    g.scale(scale, scale);
    g.textBaseline = 'middle';

    // ---- background
    g.fillStyle = C.bg;
    g.fillRect(0, 0, L.width, L.height);

    // ---- title
    g.fillStyle = C.text;
    g.font = '600 14px "Segoe UI", system-ui, sans-serif';
    g.fillText(L.title, PAD, PAD + 9);
    var titleW = g.measureText(L.title).width;
    g.fillStyle = C.faint;
    g.font = '11px "Segoe UI", system-ui, sans-serif';
    var sub = U.longLabel(L.origin) + '  →  ' + U.longLabel(L.origin + L.days - 1);
    g.fillText(sub, PAD + titleW + 16, PAD + 9);

    var top = PAD + 28;
    var tx = PAD + SIDE;                              // track origin x
    var bodyTop = top + head();
    var bodyH = L.rows.length * ROW;

    // ---- weekend shading + day rules, full height
    for (var i = 0; i < L.days; i++) {
      var d = L.origin + i, x = tx + i * L.dw;
      if (L.view.weekends && U.isWeekend(d)) {
        g.fillStyle = C.weekend;
        g.fillRect(x, top + H_MONTH, L.dw, head() - H_MONTH + bodyH);
      }
      if (L.dw >= 7) {
        g.fillStyle = C.line;
        g.fillRect(x, top + H_MONTH, 1, head() - H_MONTH + bodyH);
      }
      if (U.weekday(d) === 1) {
        g.fillStyle = C.week;
        g.fillRect(x, top, 1, head() + bodyH);
      }
    }

    // ---- today
    if (L.view.todayMarker && L.today >= L.origin && L.today < L.origin + L.days) {
      g.fillStyle = C.today;
      g.fillRect(tx + L.x(L.today), top, L.dw, head() + bodyH);
      g.strokeStyle = C.todayEdge;
      g.lineWidth = 1;
      g.strokeRect(tx + L.x(L.today) + 0.5, top + 0.5, L.dw - 1, head() + bodyH - 1);
    }

    // ---- header text
    g.font = '700 10px "Segoe UI", system-ui, sans-serif';
    g.fillStyle = C.muted;
    T.months().forEach(function (m) {
      var mx = tx + (m.x / T.dayWidth()) * L.dw;
      g.save();
      g.beginPath(); g.rect(mx, top, (m.w / T.dayWidth()) * L.dw, H_MONTH); g.clip();
      g.fillText(m.label.toUpperCase(), mx + 6, top + H_MONTH / 2);
      g.restore();
    });

    if (L.view.weekNums) {
      g.font = '9px "Segoe UI", system-ui, sans-serif';
      g.fillStyle = C.faint;
      T.weeks().forEach(function (w) {
        var wx = tx + (w.x / T.dayWidth()) * L.dw;
        if ((w.w / T.dayWidth()) * L.dw < 16) return;
        g.fillText(w.label, wx + 3, top + H_MONTH + hWeek() / 2);
      });
    }

    if (L.dw >= 12) {
      g.font = '9.5px "Segoe UI", system-ui, sans-serif';
      g.textAlign = 'center';
      for (var k = 0; k < L.days; k++) {
        var dd = L.origin + k;
        g.fillStyle = U.isWeekend(dd) ? C.faint : C.muted;
        g.fillText(U.dayLabel(dd), tx + k * L.dw + L.dw / 2, top + H_MONTH + hWeek() + H_DAY / 2);
      }
      g.textAlign = 'left';
    }

    // ---- rows
    L.rows.forEach(function (r, ri) {
      var y = bodyTop + ri * ROW;

      if (r.kind === 'group') {
        g.fillStyle = C.trackAlt;
        g.fillRect(tx, y, L.trackW, ROW);
      }
      g.fillStyle = C.line;
      g.fillRect(PAD, y + ROW - 1, SIDE + L.trackW, 1);

      // label
      g.fillStyle = r.color;
      roundRect(g, PAD + (r.kind === 'group' ? 4 : 16), y + ROW / 2 - 7, 3, 14, 1.5);
      g.fill();
      g.fillStyle = C.text;
      g.font = (r.kind === 'group' ? '600 11.5px' : '11px') + ' "Segoe UI", system-ui, sans-serif';
      g.save();
      g.beginPath(); g.rect(PAD, y, SIDE - 8, ROW); g.clip();
      g.fillText(r.name, PAD + (r.kind === 'group' ? 14 : 26), y + ROW / 2);
      g.restore();

      // bar
      if (r.start == null) return;
      var bx = tx + L.x(r.start);
      var bw = Math.max(2, (r.end - r.start) * L.dw);
      var h = r.kind === 'group' ? SUM : BAR;
      g.fillStyle = r.color;
      roundRect(g, bx, y + (ROW - h) / 2, bw, h, r.kind === 'group' ? 2 : 3.5);
      g.fill();

      if (r.kind === 'task' && L.view.barLabels && bw > 26) {
        g.save();
        g.beginPath(); g.rect(bx, y, bw, ROW); g.clip();
        g.fillStyle = U.readableInk(r.color);
        g.font = '600 10px "Segoe UI", system-ui, sans-serif';
        g.fillText(r.name, bx + 5, y + ROW / 2);
        g.restore();
      }
    });

    // ---- frame around the track
    g.strokeStyle = C.line;
    g.strokeRect(tx + 0.5, top + 0.5, L.trackW, head() + bodyH);

    return new Promise(function (resolve) {
      cv.toBlob(function (b) { download(b, fileName('png')); resolve(); }, 'image/png');
    });
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ---------------------------------------------------------- SVG */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toSVG(opts) {
    opts = opts || {};
    var L = layout(opts);
    var C = opts.paper ? PAPER : INK;
    var o = [];
    var tx = PAD + SIDE, top = PAD + 28;
    var bodyTop = top + head(), bodyH = L.rows.length * ROW;

    o.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + L.width + '" height="' + L.height +
      '" viewBox="0 0 ' + L.width + ' ' + L.height + '" font-family="Segoe UI, system-ui, sans-serif">');
    o.push('<rect width="100%" height="100%" fill="' + C.bg + '"/>');
    o.push('<text x="' + PAD + '" y="' + (top - 10) + '" fill="' + C.text +
      '" font-size="14" font-weight="600">' + esc(L.title) + '</text>');

    // grid
    for (var i = 0; i < L.days; i++) {
      var d = L.origin + i, x = tx + i * L.dw;
      if (L.view.weekends && U.isWeekend(d)) {
        o.push('<rect x="' + x + '" y="' + (top + H_MONTH) + '" width="' + L.dw +
          '" height="' + (head() - H_MONTH + bodyH) + '" fill="' + C.weekend + '"/>');
      }
      if (L.dw >= 7) {
        o.push('<rect x="' + x + '" y="' + (top + H_MONTH) + '" width="1" height="' +
          (head() - H_MONTH + bodyH) + '" fill="' + C.line + '"/>');
      }
      if (U.weekday(d) === 1) {
        o.push('<rect x="' + x + '" y="' + top + '" width="1" height="' + (head() + bodyH) +
          '" fill="' + C.week + '"/>');
      }
    }

    if (L.view.todayMarker && L.today >= L.origin && L.today < L.origin + L.days) {
      o.push('<rect x="' + (tx + L.x(L.today)) + '" y="' + top + '" width="' + L.dw +
        '" height="' + (head() + bodyH) + '" fill="' + C.today + '" stroke="' + C.todayEdge + '"/>');
    }

    // header
    T.months().forEach(function (m) {
      var mx = tx + (m.x / T.dayWidth()) * L.dw;
      o.push('<text x="' + (mx + 6) + '" y="' + (top + H_MONTH / 2 + 3.5) + '" fill="' + C.muted +
        '" font-size="10" font-weight="700" letter-spacing="1">' + esc(m.label.toUpperCase()) + '</text>');
    });
    if (L.view.weekNums) {
      T.weeks().forEach(function (w) {
        if ((w.w / T.dayWidth()) * L.dw < 16) return;
        var wx = tx + (w.x / T.dayWidth()) * L.dw;
        o.push('<text x="' + (wx + 3) + '" y="' + (top + H_MONTH + hWeek() / 2 + 3) + '" fill="' +
          C.faint + '" font-size="9">' + esc(w.label) + '</text>');
      });
    }
    if (L.dw >= 12) {
      for (var k = 0; k < L.days; k++) {
        var dd = L.origin + k;
        o.push('<text x="' + (tx + k * L.dw + L.dw / 2) + '" y="' +
          (top + H_MONTH + hWeek() + H_DAY / 2 + 3) + '" text-anchor="middle" fill="' +
          (U.isWeekend(dd) ? C.faint : C.muted) + '" font-size="9.5">' + esc(U.dayLabel(dd)) + '</text>');
      }
    }

    // rows
    L.rows.forEach(function (r, ri) {
      var y = bodyTop + ri * ROW;
      if (r.kind === 'group') {
        o.push('<rect x="' + tx + '" y="' + y + '" width="' + L.trackW + '" height="' + ROW +
          '" fill="' + C.trackAlt + '"/>');
      }
      o.push('<rect x="' + PAD + '" y="' + (y + ROW - 1) + '" width="' + (SIDE + L.trackW) +
        '" height="1" fill="' + C.line + '"/>');
      o.push('<rect x="' + (PAD + (r.kind === 'group' ? 4 : 16)) + '" y="' + (y + ROW / 2 - 7) +
        '" width="3" height="14" rx="1.5" fill="' + r.color + '"/>');
      o.push('<text x="' + (PAD + (r.kind === 'group' ? 14 : 26)) + '" y="' + (y + ROW / 2 + 4) +
        '" fill="' + C.text + '" font-size="' + (r.kind === 'group' ? 11.5 : 11) +
        '" font-weight="' + (r.kind === 'group' ? 600 : 400) + '">' + esc(r.name) + '</text>');

      if (r.start == null) return;
      var bx = tx + L.x(r.start);
      var bw = Math.max(2, (r.end - r.start) * L.dw);
      var h = r.kind === 'group' ? SUM : BAR;
      o.push('<rect x="' + bx + '" y="' + (y + (ROW - h) / 2) + '" width="' + bw + '" height="' + h +
        '" rx="' + (r.kind === 'group' ? 2 : 3.5) + '" fill="' + r.color + '"/>');
      if (r.kind === 'task' && L.view.barLabels && bw > 26) {
        o.push('<text x="' + (bx + 5) + '" y="' + (y + ROW / 2 + 3.5) + '" fill="' +
          U.readableInk(r.color) + '" font-size="10" font-weight="600" clip-path="inset(0)">' +
          esc(r.name) + '</text>');
      }
    });

    o.push('</svg>');
    download(new Blob([o.join('\n')], { type: 'image/svg+xml' }), fileName('svg'));
  }

  /* ---------------------------------------------------------- PDF */

  /**
   * The browser's print dialog, with "Save as PDF" as the destination.
   * Vector text, selectable, and no dependency - the trade-off is that
   * the user picks the paper size themselves.
   */
  function toPDF() {
    var prev = document.title;
    document.title = (S.getDoc().name || 'Schedule');
    window.print();
    setTimeout(function () { document.title = prev; }, 800);
  }

  /* ---------------------------------------------------------- data */

  function toJSON() {
    var text = JSON.stringify(S.serialize(), null, 2);
    download(new Blob([text], { type: 'application/json' }), fileName('json'));
  }

  function toCSV() {
    var rows = [['Category', 'Task', 'Start', 'End', 'Days', 'Colour']];
    S.groups().forEach(function (g) {
      if (!g.tasks.length) {
        rows.push([g.name, '', '', '', '', g.color]);
        return;
      }
      g.tasks.forEach(function (t) {
        rows.push([
          g.name, t.name,
          U.toISO(T.containing(t.start)),
          U.toISO(T.containing(t.end - 1e-6)),
          String(t.end - t.start),
          t.color
        ]);
      });
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) {
        c = String(c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\r\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), fileName('csv'));
  }

  /* ---------------------------------------------------------- import */

  function importFile(file, done) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        S.replace(JSON.parse(fr.result));
        done(null);
      } catch (err) {
        done(err);
      }
    };
    fr.onerror = function () { done(new Error('Could not read the file')); };
    fr.readAsText(file);
  }

  return {
    toPNG: toPNG, toSVG: toSVG, toPDF: toPDF,
    toJSON: toJSON, toCSV: toCSV, importFile: importFile
  };
})();
