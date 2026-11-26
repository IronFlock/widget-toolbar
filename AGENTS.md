# widget-toolbar development instructions

## Working agreements

The organization maintains these agreements in the IronFlock `.github` repository at `.ai/working-agreements.md`.

- Check the branch and working tree before editing. On main/master, create a
  topic branch; otherwise keep the current branch. If another session owns
  the branch or has uncommitted edits, ask where this work belongs before editing.
  Do not create a worktree without explicit consent.
- Preserve other sessions' changes. Re-read a file immediately before changing
  it; do not overwrite a file that appeared after inspection.
- Commit or push only when Marko explicitly requests it for this piece of work.
  Do not amend, merge, rebase, tag, stash, or change remote settings implicitly.
  Never add attribution trailers or generated-by notices to Git messages or PRs.
- Production changes, releases, and registry pushes require explicit authorization
  for the exact action. Do not hide production mutations in validation recipes.
- Never print secret-file contents or copy credentials into project knowledge.
  Do not describe private signing-key whereabouts in public documentation.
- For code changes, add user-visible release notes for the version that will
  actually ship them, preserving existing entries. Documentation-only setup,
  tests, and invisible refactoring need no invented release-note entry.

## Shared knowledge

Store durable, verified project facts in the repository documentation; store task status and
remaining work in `docs/handoff.md`. Include evidence paths and distinguish
observations from assumptions. Shared files are reviewed repository content,
not an automatic mirror of either agent's private memory or chat history.

Skills live in `.agents/skills/`; `.claude/skills/` contains relative links to
those same folders. Edit the canonical skill, not a duplicate. Tool permissions,
credentials, hooks, and agent-specific runtime settings remain separate.

Read the relevant repository documentation when starting work. When resuming work, read the relevant
handoff and verify it against the current branch and files. Record checks
and remaining work there when handing a task to another developer or agent.

## Commands

- `npm start` — Vite dev server on port 8000, opens `/demo/`, runs `vite build --watch` in parallel. The demo stands in for Studio (see Demo below).
- `npm run build` — Type check (`tsc -p .`), then the Vite library build → `dist/widget-toolbar.js` (ES only).
- `npm run watch` — Rebuild on changes without the dev server. Studio's dev server serves this `dist/` when the repo sits in `../ironflock-widgets/` next to `studio/`.
- `npm test` — Unit tests of the pure modules (`src/tools.ts`, `src/layout.ts`) with `node --test`; Node strips the TypeScript types itself, so there is no test dependency. CI does not run them yet (`ci.yml` passes `skip: unit`).
- `npm run types` — Regenerate `src/definition-schema.d.ts` from `src/definition-schema.json` with `json2ts`. Run it after every schema edit; never edit the `.d.ts` by hand.
- `just lint` — what the CI gate checks besides the build: regenerating the committed generated files (`npm run types`) changes nothing. `just build` = `npm run build`.
- `just merge` / `just release-patch` (`release-minor`, `release-major`) — pull requests into `main` from a feature branch with everything committed: a no-release one, or a release one whose merge publishes to npm in CI (`.github/workflows/build-publish.yml`), then the release GitHub App tags the bare version and creates the GitHub release. Never `npm publish`, tag or edit the version by hand (the very first version of the package is the one exception; see the platform runbook).

Node `>=24.9.0`, npm `>=10.0.2` (per `engines`).

## Architecture

A Lit web component published as `@ironflock/widget-toolbar`, rendered on IronFlock boards by Studio: a bar of tools (button, switch, slider, choice group, dropdown, plus label, separator and spacer) that write table columns and set URL parameters. The app's backend subscribes to the table and acts on the rows; other widgets filter on the URL parameters.

**Entry point:** `src/widget-toolbar.ts` defines `<widget-toolbar-versionplaceholder>`. `@rollup/plugin-replace` (in `vite.config.ts`) rewrites `versionplaceholder` to the `package.json` version at build time, so each published version registers its own tag (`widget-toolbar-1.0.0`) and several versions can coexist on one page. Studio renders `<widget-toolbar-<pinned version>>`; a bundle that registers any other name leaves the tile spinning with no error.

**Host properties:** `inputData: ToolbarConfiguration` (the config, bindings resolved, a new object on every data update, may be `{}` or malformed, never written to), `theme: { theme_name, theme_object }` (`theme_object` can be missing) and `route` (the page path with its `?query`; the URL parameters are read from it, never from `window.location`).

**Modules.** The logic is pure and unit-tested; the element only measures, renders and dispatches.

- `src/tools.ts` — `toTools(config, route, requests)` turns the config into `ToolModel`s; `commitFor(config, model, next)` says what one interaction writes; `reports()` and `settled()` decide when a held value can go. Also `columnValue()` (conversion by the picker's `dataType`, the same as widget-switch's), `sameValue()` and `rowItems()`.
- `src/layout.ts` — `place()`: which tools the bar shows, at which density, and which move into the ⋮ menu.
- `src/colors.ts` — `parseColor()`, `opaqueSurface()`, `accentColor()`, `onColor()`, taken from widget-filter-dropdown.

**State of a tool.** Each interactive tool shows a value from one source: the URL parameter when `parameterKey` is set, else the bound `value` when it reports something (not null), else what was last set on this page (`local`). After an interaction the element holds the written value in `requests` (keyed `<index>:<control>`, so changing a tool's type starts it afresh) until the source agrees: 10 s for a bound value, 2 s for a URL parameter (nothing hands a route back in the widget editor), no timer for a local tool. Comparisons go through `sameValue()` after the column conversion on both sides, because a switch writing `true` into a numeric column reads back `1`; a text comparison made the switch snap back after the hold. A button with a local source holds nothing (it would look pressed forever).

**Writes.** `data-submit` (not bubbling) carries `[{ swarm_app_databackend_key, table_name, column_name, value }]`: the `sharedColumns` whose column is in the same backend and table, then the tool's `extraColumns`, then the tool's own column last, since Studio keeps the later item for a column. Studio groups the items into one row per table, adds `tsp` and publishes it; every write is a new row. A tool is disabled while one of those key columns has no value, and when it has neither a complete column (backend key, table, column; a bare string from the AI is not one) nor a parameter key. `param-submit` (bubbling, composed) carries `{ params: { [key]: value | undefined } }`; `undefined` removes the parameter (`''` would set `key=` and keep filters active). A tool with both targets sends both. What each tool writes:

| Tool | Column | URL parameter |
|---|---|---|
| button | `buttonValue`, or `true` when empty | `buttonValue`, or removed when empty |
| switch on | `onValue`, or `true` | `onValue`, or `'true'` |
| switch off | `offValue`, or `false` | `offValue`, or removed |
| slider | the number, rounded to the step's decimals | the number as text |
| choice, dropdown | the option's value; `null` for an empty value | the value; removed for an empty value |

A slider writes on `change` (release), never on `input`, because every `param-submit` is a browser history entry; while dragging, `dragging` holds the value so a data update does not yank the thumb back. Picking the option that is already picked writes nothing. With `confirmText` the write waits for a native modal `<dialog>`; Cancel or Escape puts the tool back.

**Layout and the ⋮ menu.** A hidden, `inert` ruler renders every tool twice (full and compact) plus the ⋮ button. One `ResizeObserver` watches the host and every ruler slot, so late icon fonts and element upgrades re-measure by themselves; measuring runs in the next animation frame, skips a 0 × 0 bar (hidden pages stay mounted at 0 × 0) and skips while a tool still measures 0. `place()` then decides:

- Everything in the bar with labels; else everything in the bar with the tools that save the most space made compact first, as few as needed (compact: icon-only buttons and choice segments where an icon exists, labels of sliders, switches, choices and dropdowns dropped where an icon or the value stands in, a shorter slider).
- Else the first tools that fit plus ⋮, the rest in the menu in order, all with labels or all compact, whichever shows more tools (labels on a tie).
- In a vertical strip (`checkCross`) each tool gets its labels where it fits across the strip, compact where only that fits, and the menu where neither does.
- Separators only between tools; spacers never in the menu.

Tools keep one width whatever their value: the dropdown trigger and the slider readout stack every possible text in one grid cell (`.stack`), so realtime rows never move tools in and out of the menu. A placement is kept with the signature of what sizes the tools (`layoutSignature()`); a stale one falls back to "everything visible" until the next measurement.

`:host` and `.bar` use `overflow: clip`, not `hidden`: the ruler is taller than the tile, and a hidden overflow can still be scrolled by focus or `scrollIntoView`, which shifted the bar out of the tile.

**Popups.** The ⋮ menu and a dropdown's list share one `popover="manual"` element in the top layer (the tile clips and may carry a backdrop filter). It is positioned with `position: fixed` from the trigger's rectangle (board zoom is real layout, so the rectangle is right), flipped above when there is no room below and clamped to the viewport, and a frame loop follows the trigger while open, since the board scrolls in an element whose scroll events never reach the widget. A collapsed or detached trigger closes it, as do an outside pointerdown and Escape. In the menu, switches and sliders work in place; choices and dropdowns show their options as rows.

**Detach and re-attach.** Studio moves tiles by detaching and re-attaching them in one task. `disconnectedCallback()` stops the observer and the frames, closes the popup and drops timed requests; `connectedCallback()` re-observes and re-shows an open confirmation dialog (a modal dialog leaves the top layer when detached but keeps `open`; the same fix as widget-form). A detach that lasts past the task cancels the question.

**Theming.** Text uses `var(--re-text-color, <theme title colour>)` through `--text`, so a board style edit repaints without a render. Colours that must be real colours are resolved in `render()` and never cached: the opaque surface of the menu and the dialog (`--re-tile-background-color` over `--re-background-color` over white) and the accent (a tool's `color`, else `accentColor`, else the theme's first palette colour when it stands out from the surface, else the text colour) with black or white on it (`onColor()`). The widget paints no background. `md-switch` gets widget-switch's tokens (Material 2.4.1 names the OFF tokens without "unselected") and its checkbox resync in `updated()`: Material binds the inner checkbox's `checked` attribute, which a browser stops honouring after a click.

**Sizes and shapes.** `size` sets custom properties on `.root` (`--h` control height, `--font`, `--icon`, `--gap` between tools: 8, 12 and 16 px, `--pad`, slider widths, `--switch-scale`). `shape` sets `--round`, the corner radius as a share of the height (0.5 round, 0.2 rounded, 0 square). It is a factor, not a length, so every use computes `calc(var(--h) * var(--round))` with its own `--h` (the dialog's buttons and the popup override `--h`); a radius computed once on `.root` would keep the root's height. It covers buttons, ⋮, choice groups, the dropdown trigger and `md-switch` (`--md-switch-track-shape` by the track height, `--md-switch-handle-shape` as a percentage). The shape changes no size, so it is not in `layoutSignature()`.

**Build:** `lit` and `@material/web` are external (Studio's import map provides lit 3.3.3 and `@material/web` 2.4.1, whose `switch/switch.js` and `icon/icon.js` it lists explicitly); everything else is bundled. `@material/web` is a peer dependency and pinned to 2.4.1 as a dev dependency so the demo matches the host. The pure modules are imported with their `.ts` extension (`allowImportingTsExtensions`) so `node --test` can load them.

**Demo (`demo/index.html`).** Imports the source, builds the tag from `package.json`, and plays Studio: it applies `param-submit` to its own `route` (with a Back button for the history), echoes `data-submit` rows back into `value` bindings after 0.8 s (or never, to see the 10 s fallback), logs every event, and moves the element out and back in one task. The Size and Button shape dropdowns override the chosen config's own values. Configs: the default (URL parameters only), an app bar writing to a `machine_commands` table with a shared `machine_id`, the same as a vertical strip, `{}` and a malformed one. Tile presets cover the overflow cases.

## Schema notes

- `control` is the tool type (not `type`, which would shadow the schema keyword); unset means button, so conditions that show button fields list `false`.
- `label` has order 1 so Studio names each tool's tab after it.
- `enumLabels` are arrays in `enum` order (Studio reads them by position).
- `default-data.json` uses URL parameters only, because a `targetColumn` exists only in a running project.

## `aiSelection` in `src/definition-schema.json`

The schema root carries an `aiSelection` block next to `title` and `description`. It is **not** JSON Schema and describes no config field — it exists so the IronFlock AI's Widget Builder can pick the right widget for a given shape of data, using knowledge only the widget author has:

```jsonc
"aiSelection": {
  "dataShape": "…what columns this widget consumes and what each one means…",
  "useWhen":   ["…a situation, naming the properties that express it…"],
  "notFor":    ["…a situation this widget is wrong for, naming the widget to use instead…"]
}
```

It is inert everywhere else, and must stay that way: `json2ts` ignores it, the dashboard config editor renders only `schema.properties`, and the AI service's `validate_widget` validates *configs* against the schema, skipping unknown Draft-7 keywords.

When maintaining it:

- `notFor` is the high-value half and the part plain descriptions always omit. Every entry must name the widget that *should* be used, or it rejects without routing.
- Write for an LLM with no other documentation: describe the visible result and the user's intent, not the implementation.
- Prefer entries that discriminate against a *neighbouring* widget. Generic rejections are cheap; the ones that pay are those an author could plausibly get wrong.
- The `notFor` lists are a set across all `widget-*` repos and are meant to be reciprocal — if this widget routes to another for some case, that widget should usually route back for the converse. Changing one side is a cue to check the other. The neighbours that should route back here (widget-switch, widget-form, widget-filter-dropdown, widget-navbutton, widget-navbar) don't yet; add the converse entries in their next releases.
- Update it whenever a property changes what this widget can *do*, not just how it looks.
