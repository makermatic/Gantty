# Roadmap

What's built, what's next, and what's parked. Nothing here is committed to —
it's a list to argue with.

---

## Built

- Categories with collapsible task rows, matching the Kitsu layout
- Summary bars that auto-span their children and drag them together
- Pixel-exact drag with day-snap on release, plus a free-positioning mode
- Edge resize on task bars
- Draw a new task by dragging across empty track
- Harmony-style range knobs at both ends of the timeline, clamped so they
  can't swallow a bar
- Auto-scroll at the edges while dragging; range auto-grows past the end
- Row reordering, including moving a task between categories
- Zoom about the cursor, week numbers, weekend shading, today marker
- Today / Start Today / Fit
- Undo & redo with gesture coalescing
- Autosave + JSON, CSV, PNG, SVG and PDF export
- Inline rename, colour picker, context menus, edit dialog
- Keyboard shortcuts throughout

---

## Next — small, high value

**Multi-select.** Shift-click or rubber-band several bars, then drag them as a
group. The most likely first request once the tool is in real use.

**Copy / paste.** `Ctrl+C` / `Ctrl+V` on a selected task or category, pasting
at the cursor's date.

**Milestones.** A zero-length task rendered as a diamond. Every schedule grows
these eventually.

**Light theme.** The palette is already CSS custom properties and the exporters
already carry a `PAPER` colour set — this is mostly a toggle and a media query.

**Row height control.** Denser rows for long schedules.

---

## Later — bigger

**Direct PDF with page control.** A vector PDF writer (roughly 200 lines for
the subset needed: paths, rects, text, one embedded font) would let us choose
the page size, split a long chart across pages and add a title block, instead
of handing the job to the print dialog. Only worth it if the print route
proves too coarse in practice.

**Per-task notes and links.** A notes field in the edit dialog, shown on hover
and carried through JSON and CSV export.

**Progress on bars.** A percent-complete fill, as Kitsu shows.

**Grouping by assignee.** A second way to slice the same tasks — the `MS` row
in the reference screenshot is a person, not a task. This would mean tasks
carrying an owner and the sidebar offering a "group by" switch.

**Templates.** Save a category structure (episode pipeline, asset pipeline) and
stamp it out at a chosen date.

**Import from Kitsu.** Its API exposes tasks with start/end dates. A one-way
import would make this a planning scratchpad alongside a real Kitsu instance.

---

## Parked, with reasons

**Task dependencies.** Arrows, cycle detection, and a scheduler that pushes
successors when a predecessor moves. It's a genuinely different tool, and it
directly contradicts "nothing should be constrained". Revisit only if the
looseness turns out to be the problem rather than the point.

**Multi-user editing.** Needs a server, auth and conflict resolution. JSON
export covers sharing for now.

**Deeper nesting.** Two levels cover the reference. Arbitrary depth complicates
reordering, summary maths and the sidebar for no stated need.

**Virtualised rows.** Only matters past a few hundred rows. The date grid is
already virtualisation-free by design (CSS gradients, not elements), so the
horizontal axis scales fine; it's the vertical axis that would need it.

---

## Ideas without a home yet

- Snap a bar's edge to a neighbouring bar's edge when it comes within a few
  pixels, with a modifier to suppress it
- A "today" column that stays pinned while you scroll
- Shareable read-only link via a URL-encoded document
- Per-category default task length
- Working-days-only mode, where weekends don't count toward a duration
