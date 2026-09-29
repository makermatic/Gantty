# Gantty

A loose, Kitsu-style Gantt scheduler that runs in a browser with no install,
no build step and no server.

Drag bars around a calendar. They follow your cursor pixel-for-pixel and settle
onto whole days when you let go — the feel is free, the dates stay clean.

---

## Running it

Double-click `index.html`. That's it.

It works straight off the disk (`file://`) because the scripts are plain
`<script>` tags rather than ES modules. Dropping the folder on GitHub Pages,
Netlify or any static host also works unchanged.

**One caveat on `file://`:** some browsers disable `localStorage` for local
files. If autosave is unavailable the app still works fine — it just won't
remember your work between sessions, so use **Export → Project file (JSON)**.
Serving the folder over `http://` (for example `npx serve .`) restores autosave.

### Hosting it

There's no build step, so any static host works. `netlify.toml` is included
and configured — publish directory `.`, no build command.

The quickest route is [Netlify Drop](https://app.netlify.com/drop): drag the
project folder onto the page and you get a URL. For deploys on every push,
connect the GitHub repo instead; Netlify reads `netlify.toml` and needs no
further setup. GitHub Pages, Cloudflare Pages and Vercel all work the same way.

Hosting it over `https://` also makes autosave reliable, which the `file://`
caveat above doesn't guarantee.

**What hosting does *not* give you:** shared schedules. Everything lives in
each visitor's own browser storage, so two people opening the same URL see
their own separate work. Sharing means exporting a JSON project file and
sending it. Making schedules genuinely shared would need a backend — see
`docs/ROADMAP.md`.

---

## The model

Two levels, deliberately:

```
Category            "Shot / Cel"     collapsible, has a colour
  └── Task          "Blocking"       has a colour bar on the calendar
```

A category's bar is a **summary**: it automatically spans from its earliest
task's start to its latest task's end. Drag the summary and every task inside
it moves together, keeping their relative spacing. Expand the category to move
tasks individually.

A category with no tasks has no bar — give it a task and one appears.

---

## Mouse

| Gesture | What it does |
| --- | --- |
| Drag the middle of a bar | Move it |
| Drag a bar's left or right edge | Resize that end |
| Drag across empty track | Draw a new task in that category |
| Double-click empty track | New five-day task starting there |
| Double-click a task bar | Open the edit dialog |
| Double-click a category bar | Collapse / expand it |
| Right-click anything | Context menu (rename, duplicate, colour, delete) |
| Drag the dotted grip in the sidebar | Reorder rows, or move a task to another category |
| Drag the square knob at either end of the timeline | Stretch or trim how many days are shown |
| Double-click either knob | Shrink-wrap the timeline around your schedule |
| Ctrl + scroll | Zoom, keeping the day under the cursor pinned |
| Shift + scroll | Pan sideways |

Dragging near the left or right edge auto-scrolls. Dragging a bar past the end
of the timeline grows the range to fit it rather than losing it.

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl+G` | New category |
| `Ctrl+Enter` | New task in the selected category |
| `←` `→` | Nudge the selection by a day |
| `Alt` + `←` `→` | Nudge by a week |
| `Shift` + `←` `→` | Stretch the selection's end date |
| `Delete` | Delete the selection |
| `T` | Jump to today |
| `+` `−` | Zoom |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+S` | Save a project file |
| `Ctrl+O` | Open a project file |
| `Ctrl+P` | Print / save as PDF |
| `Escape` | Close a menu or dialog |

Click a name in the sidebar to rename it in place. `Enter` commits, `Escape`
reverts.

---

## Dates and "today"

Three separate things, because they're genuinely different jobs:

- **Today** — scrolls the view so today's column is at the left edge. Doesn't
  touch your data.
- **Start Today** — shifts the *entire schedule* so its earliest task begins
  today, keeping every gap and duration intact. This is the "snap the first
  date to today" behaviour.
- **Fit** — zooms and scrolls so the whole schedule fills the window.

Today's column is tinted green and its date is underlined in the header, the
way Kitsu marks it.

Weeks are Monday-based with ISO week numbers, and months read `AUGUST 26` —
both matching Kitsu.

---

## Saving and exporting

Your work autosaves to the browser as you go. On top of that:

| Format | What it's for |
| --- | --- |
| **PNG** | An image to paste into a deck or a message. Drawn at 2× from the real geometry, not screenshotted. |
| **SVG** | Vector, for print or for editing in Illustrator / Inkscape. |
| **PDF** | Goes through the browser's print dialog — pick "Save as PDF" as the destination. Text stays selectable. |
| **JSON** | The project file. Round-trips exactly; commit it to git or email it. |
| **CSV** | One row per task, for a spreadsheet. |

**Open** loads a JSON project file back in.

The JSON also carries human-readable `startDate` / `endDate` fields next to the
internal numbers, so it's readable and hand-editable. A file containing only
ISO dates imports fine.

---

## Layout of the code

| File | Responsibility |
| --- | --- |
| `index.html` | Markup and script order |
| `css/app.css` | Everything visual, including the print stylesheet |
| `js/util.js` | Date maths, DOM helpers, the colour palette |
| `js/state.js` | The document, undo/redo, autosave, all mutations |
| `js/timeline.js` | The one place that maps days ↔ pixels |
| `js/render.js` | Document → DOM |
| `js/interact.js` | Every pointer gesture |
| `js/exporters.js` | PNG, SVG, PDF, JSON, CSV |
| `js/main.js` | Boot, toolbar, menus, dialogs, keyboard |

`docs/DESIGN.md` explains why it's shaped this way.
`docs/ROADMAP.md` lists what's deliberately not built yet.

## Tests

`tests/logic.test.js` covers the date maths and the state model — the parts
where a bug would quietly corrupt a schedule. Run with:

```
node tests/logic.test.js
```

No dependencies, no test runner.
