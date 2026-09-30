# Ganty — design notes

Why the thing is shaped the way it is. Read `README.md` first for what it does.

---

## 1. The brief

> "Similar functionality to Kitsu. You can slide dates and colors from left to
> right, and it's very, very loose. It's not like it snaps to a specific date…
> hover over a task's color bar and drag it to expand or shrink the bar."

Plus, from a follow-up: a draggable marker at the end of the timeline that
extends how many dates are shown, like Toon Boom Harmony's timeline.

The operative word is **loose**. Everything below serves that.

---

## 2. Decisions

### 2.1 Loose feel, clean data

Kitsu *looks* unconstrained but its bars land on whole days. That's not a
compromise — it's what makes the looseness safe. If bars settled wherever you
dropped them, a task would start at "Aug 14, 3:17pm" and every export, every
duration count and every hand-off downstream would inherit that noise.

So the split is:

- **During the drag**, the bar follows the cursor pixel-for-pixel. No stepping,
  no snapping preview, no lag. This is the entire feel.
- **On release**, it settles onto a whole day.
- **A tooltip** shows the dates it will land on while you drag, so the snap is
  never a surprise.

There's a **Free positioning** toggle in the gear menu for when a quarter-day
grid is genuinely wanted. The model stores day numbers as floats, so this costs
nothing structurally.

**Chosen over:** true sub-pixel freedom (fuzzy dates, messy exports) and
snap-during-drag (kills the feel outright).

### 2.2 Days as integers, not `Date` objects

`start` and `end` are **float day numbers** — days since the Unix epoch, UTC —
with `end` exclusive.

```js
task = { start: 20678, end: 20683 }   // five days
```

Three things fall out of this for free:

- **Geometry is arithmetic.** `x = (day - origin) * dayWidth`, `width =
  (end - start) * dayWidth`. No date library, no special cases.
- **Daylight saving can't move a bar.** A calendar day is exactly `1`,
  always. Local-time `Date` arithmetic silently gains and loses hours twice a
  year, and a Gantt chart is exactly where that shows up.
- **Durations are subtraction.** `end - start`. Month lengths and leap years
  never enter into it.

Exclusive `end` is why the width formula has no `+1` in it. The UI shows
inclusive end dates because that's what people mean by "ends Friday"; the
conversion happens at the edges (`render.rangeText`, the edit dialog, CSV).

Saved JSON carries `startDate` / `endDate` ISO strings alongside the numbers,
so the file is readable and hand-editable, and a file with *only* ISO dates
imports fine.

### 2.3 Category bars are summaries

A category's bar spans its earliest task to its latest, and dragging it moves
every task inside by the same delta. This is what makes a collapsed view worth
looking at — the screenshot's collapsed rows each say something.

Resize handles are hidden on summary bars. Stretching a summary has no single
sensible meaning (scale the children? move only the outermost?), so it's not
offered rather than guessed at.

**Chosen over:** independent category bars, where a collapsed row tells you
nothing.

### 2.4 The timeline range is data, not a viewport

`view.origin` and `view.days` say what slice of calendar the chart covers. They
are saved with the document.

The Harmony-style knobs at either end drag those two numbers directly. Trimming
is clamped so it can never swallow an existing bar — the alternative is a task
that silently vanishes off the end, which is the worst possible failure for a
scheduling tool. Dragging a bar *past* the end grows the range instead of
clipping it.

The left knob hides itself once it scrolls behind the sticky sidebar, since it
marks x=0 of the track and would otherwise float confusingly over the labels.

### 2.5 Plain scripts, no build

Classic `<script>` tags, one global `G`. Consequences:

- `index.html` opens by double-click. No `npm install`, no dev server, no
  toolchain that rots.
- ES modules would have been tidier but need `http://` — they fail on
  `file://` from CORS. That trade was not worth it here.
- Code still lives in seven focused files instead of one blob.

### 2.6 Exports are drawn, not screenshotted

PNG and SVG are rendered from the same geometry the screen uses
(`G.timeline`), not captured from the DOM.

- No `html2canvas`, no CDN, no offline breakage, no tainted-canvas surprises.
- Crisp at any scale; PNG renders at 2× by default.
- Exports use their own day width and row height, so a chart that's zoomed
  right in on screen still exports legibly.

PDF goes through the browser's print pipeline with the print stylesheet in
`css/app.css`. Text stays real, selectable, vector text. The cost is that the
user picks the paper size in the print dialog rather than us choosing it.

### 2.7 Undo is whole-document snapshots

Documents are small (kilobytes), so snapshotting is simpler and more reliable
than a command log, and no operation can forget to register itself.

Continuous gestures coalesce with a `tag`: a whole drag pushes one entry, not
one per `pointermove`. `endGesture()` closes the tag on pointer-up and key-up.

History depth is capped at 80.

---

## 3. Architecture

```
util.js       dates, DOM helpers, palette        (no dependencies)
   ↓
state.js      the document, mutations, undo, autosave
   ↓
timeline.js   days ↔ pixels                       (the single source of truth
   ↓                                               for geometry)
render.js     document → DOM
   ↓
interact.js   pointer gestures → state mutations
exporters.js  document + timeline → PNG/SVG/PDF/JSON/CSV
main.js       boot, toolbar, menus, dialogs, keyboard
```

Data flows one way. A gesture calls a `state` mutation; `state` emits; `main`
re-renders on the next animation frame. Nothing writes to the DOM to
communicate with another module.

### The one deliberate exception

Dragging writes **straight to the moving bar's inline style** and skips the
render loop entirely, then commits to `state` on release. Re-rendering per
`pointermove` would be both wasteful and wrong — it would destroy the very
element the gesture is holding a reference to.

For the same reason, **selection never triggers a rebuild**. A drag selects on
pointer-down; if that rebuilt the rows, the drag would be holding a detached
node a millisecond later. `render.updateSelection()` flips classes instead.

### Why the grid is CSS gradients

Day rules, week rules and weekend shading are three repeating background
layers, each sized to exactly one repeat so the tiling is seamless, with the
week-aligned layers offset to the Monday on or before the origin.

A year-long chart at 26px/day is 365 columns × N rows. As divs that's tens of
thousands of nodes and a visibly janky zoom. As backgrounds it's three
declarations, and zooming is one number changing.

Day *numbers* in the header are still real elements, but they thin out as you
zoom out (`timeline.density()`): every day above 18px, week starts only above
9px, months alone below that.

---

## 4. What's deliberately absent

| Not built | Why |
| --- | --- |
| Dependencies between tasks | A different tool. Adds arrows, cycle detection, and constraint propagation that fights the "nothing is constrained" brief. |
| Resource assignment | Kitsu has it because it's a production tracker. This is a chart maker. |
| Nesting beyond two levels | Categories and tasks cover the screenshot. Arbitrary depth complicates reorder, summaries and the sidebar for a case nobody asked for. |
| Multi-user / a server | The brief is a local tool. JSON export is the sharing story. |
| Vertical virtualisation | Rows are few. Worth adding above ~500 rows, not before. |

See `ROADMAP.md` for what's next rather than never.

---

## 5. Known limits

- **`localStorage` on `file://`** is disabled in some browsers. Autosave
  degrades silently (it's wrapped in try/catch) and the app still works; JSON
  export is the fallback. Serving over `http://` fixes it.
- **Very long ranges** (multi-year at high zoom) put a lot of day-number
  elements in the header. The density thinning handles the common cases; a
  windowed header would be the fix if it ever bites.
- **PDF paper size** is the user's choice in the print dialog, not ours.
- **Touch** works through pointer events, but nothing is tuned for it — the
  resize handles are 8px wide, which is fine for a mouse and fiddly for a
  finger.
