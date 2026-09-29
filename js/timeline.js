/* ============================================================
   timeline.js - geometry: days <-> pixels, and header segments

   One place owns the mapping between calendar days and screen x.
   Everything else (rendering, dragging, export) asks this module,
   so the PNG/SVG exporters line up with the DOM for free.
   ============================================================ */

G.timeline = (function () {
  var U = G.util, S = G.state;

  function view()       { return S.view(); }
  function dayWidth()   { return view().dayWidth; }
  function origin()     { return view().origin; }
  function days()       { return view().days; }
  function trackWidth() { return days() * dayWidth(); }

  /** width of the sticky left column, read from CSS so the two agree */
  function sidebarWidth() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--side-w');
    return parseFloat(v) || 300;
  }
  function rowHeight() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--row-h');
    return parseFloat(v) || 54;
  }
  function headHeight() {
    var cs = getComputedStyle(document.documentElement);
    return (parseFloat(cs.getPropertyValue('--head-months')) || 30) +
           (parseFloat(cs.getPropertyValue('--head-weeks'))  || 20) +
           (parseFloat(cs.getPropertyValue('--head-days'))   || 26);
  }

  /* ---------------------------------------------------------- mapping */

  /** day number -> x in px, measured from the left edge of the track */
  function x(day) { return (day - origin()) * dayWidth(); }

  /** x in px (track-relative) -> float day number */
  function day(px) { return origin() + px / dayWidth(); }

  /** px -> whole days, for deltas (no origin involved) */
  function pxToDays(px) { return px / dayWidth(); }
  function daysToPx(d)  { return d * dayWidth(); }

  /**
   * Round a day value according to the current snap mode.
   * Snap on  -> whole days (what Kitsu does).
   * Snap off -> quarter days, so a bar can sit mid-day without the
   *             numbers turning into noise.
   */
  function snap(d) {
    if (view().freeDrag) return Math.round(d * 4) / 4;
    return Math.round(d);
  }

  /** the calendar day a float day value sits in */
  function containing(d) { return Math.floor(d + 1e-9); }

  /* ---------------------------------------------------------- header */

  /**
   * Month bands across the visible range.
   * -> [{ day, x, w, label }]
   */
  function months() {
    var o = origin(), n = days(), dw = dayWidth(), out = [];
    var cur = U.monthStart(o);
    while (cur < o + n) {
      var len = U.monthLength(cur);
      var s = Math.max(cur, o);
      var e = Math.min(cur + len, o + n);
      if (e > s) out.push({ day: cur, x: (s - o) * dw, w: (e - s) * dw, label: U.monthLabel(cur) });
      cur += len;
    }
    return out;
  }

  /**
   * Week bands (Monday-based, like Kitsu).
   * -> [{ day, x, w, label }]  label is the ISO week number
   */
  function weeks() {
    var o = origin(), n = days(), dw = dayWidth(), out = [];
    var cur = U.weekStart(o);
    while (cur < o + n) {
      var s = Math.max(cur, o);
      var e = Math.min(cur + 7, o + n);
      if (e > s) out.push({ day: cur, x: (s - o) * dw, w: (e - s) * dw, label: String(U.isoWeek(cur)) });
      cur += 7;
    }
    return out;
  }

  /**
   * Every day cell in range.
   * -> [{ day, x, w, label, weekend, today, weekStart }]
   */
  function dayCells() {
    var o = origin(), n = days(), dw = dayWidth(), t = U.today(), out = [];
    for (var i = 0; i < n; i++) {
      var d = o + i;
      out.push({
        day: d,
        x: i * dw,
        w: dw,
        label: U.dayLabel(d),
        weekend: U.isWeekend(d),
        today: d === t,
        weekStart: U.weekday(d) === 1
      });
    }
    return out;
  }

  /**
   * How much label detail fits at the current zoom.
   * Below ~14px per day the day numbers stop being readable, so we
   * thin them out rather than letting them overlap.
   */
  function density() {
    var dw = dayWidth();
    if (dw >= 18) return 'day';      // every day number
    if (dw >= 9)  return 'week';     // week starts only
    return 'month';                  // months and week ticks only
  }

  /* ---------------------------------------------------------- scrolling */

  function scrollEl() { return document.getElementById('scroll'); }

  /** put `day` at the left edge of the visible track area */
  function scrollToDay(d, align) {
    var sc = scrollEl();
    if (!sc) return;
    var target = x(d);
    if (align === 'center') target -= (sc.clientWidth - sidebarWidth()) / 2;
    else target -= 12;                                  // a hair of breathing room
    sc.scrollLeft = Math.max(0, target);
  }

  /** the float day currently under the left edge of the track */
  function firstVisibleDay() {
    var sc = scrollEl();
    if (!sc) return origin();
    return day(sc.scrollLeft);
  }

  /** convert a mouse event to a float day, given the track element */
  function dayFromEvent(ev, trackEl) {
    var r = trackEl.getBoundingClientRect();
    return day(ev.clientX - r.left);
  }

  return {
    view: view, dayWidth: dayWidth, origin: origin, days: days,
    trackWidth: trackWidth, sidebarWidth: sidebarWidth,
    rowHeight: rowHeight, headHeight: headHeight,
    x: x, day: day, pxToDays: pxToDays, daysToPx: daysToPx,
    snap: snap, containing: containing,
    months: months, weeks: weeks, dayCells: dayCells, density: density,
    scrollEl: scrollEl, scrollToDay: scrollToDay,
    firstVisibleDay: firstVisibleDay, dayFromEvent: dayFromEvent
  };
})();
