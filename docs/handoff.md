# Handoff: widget-toolbar 1.0.0

Status on 2026-11-26. The widget is finished and committed as the first commit of
`main`, pushed to `IronFlock/widget-toolbar`. It is not on npm yet: the first
publish is a manual step (see "Open"). The platform registration is prepared,
uncommitted, on topic branches in the other repositories.

## Done and verified

- Scaffolded with the ironflock-widgets skill's `new_widget.py`. Then brought in
  line with the fleet: `AGENTS.md` instead of `CLAUDE.md`, `.claude/` and
  `.codex/` from widget-toast, the blocking `security.yml`, and the `nosemgrep`
  note in `build-publish.yml`.
- Schema, default config, component (`src/widget-toolbar.ts`, `src/tools.ts`,
  `src/layout.ts`, `src/colors.ts`), demo, README, AGENTS.md and thumbnails.
- Checks run before the commit:
  - `npm run build` passes, including the `tsc` type check.
  - `npm test` passes: 30 unit tests of `tools.ts` and `layout.ts`.
  - `npm run types` changes nothing.
  - `check_widget.py --typecheck` reports 0 errors. Its one warning, "CLAUDE.md
    missing", is the checker lagging the fleet's move to AGENTS.md.
  - `npm audit --omit=dev` finds 0 vulnerabilities.
  - `npm pack --dry-run`: 13 files, 171 kB.
  - The AI text (description plus aiSelection) is 1,636 characters.
- Driven in the demo with Playwright (Chromium), with no console errors:
  - URL parameters: set and remove, Back, the switch checkbox resync.
  - Table rows: shared, extra and own column order; read-back; the 10 s hold.
  - Confirmation: Cancel, OK, a tile move with the dialog open, a real
    detach (which cancels).
  - Dropdown list and ⋮ menu in the top layer, closing on an outside click
    and on Escape.
  - Overflow at 900, 400, 150 and 40 px wide, and in vertical strips from
    540 down to 64 px (a long dropdown option in a wide strip included).
  - Sizes small, normal and big; button shapes round, rounded and square.
  - Light, dark and no theme; `{}`; a malformed config.

## Not verified

- Inside Studio itself. That needs Studio's registration (prepared) and the
  package on npm, or a board tile pinned to 1.0.0 on Studio's dev server with
  this checkout next to it.
- Browsers other than Chromium. In particular the `popover` and modal
  `<dialog>` behaviour on Safari, and the native range input's `accent-color`
  styling.

## Open

1. **Published**: Marko published 1.0.0 by hand on 2026-11-26; npm and
   jsDelivr serve it. On 2026-11-27 the GitHub side of the release flow was
   copied from widget-doughnut: auto-merge, squash merges only with the pull
   request title and body, branches deleted after merge; the rulesets
   "main: pull requests with green checks" and "release tags: admins and the
   release App"; the `release` environment (deployments from `main` only)
   with the variable `RELEASE_APP_CLIENT_ID`. The ironflock-release App is
   installed on all repositories. Still open (Marko), before the first
   `just release-patch`: the environment secret `RELEASE_APP_PRIVATE_KEY`,
   and `setup-trusted-publishing.sh` without `--bootstrap` for the npm trust
   rule (2FA). 1.0.0 has no git tag or GitHub release; the release App
   creates them from the next release on.
   The next release (1.0.1) carries new thumbnails: the horizontal toolbar
   alone, centred, instead of the three-tile board scene.
2. **After the publish**, done and uncommitted:
   - studio, branch `add-widget-toolbar` (release PR #142): both lockfiles
     list widget-toolbar 1.0.0; a clean `bun install --frozen-lockfile` and
     `npm ci` pass. #142's checks failed only because these were missing.
   - ai-plugins, branch `widget-toolbar-catalog`: the catalog rebuilt with
     the Toolbar, `tests/boards/toolbar.yml`, a changelog entry.
3. **Platform registration**, prepared uncommitted on branch
   `add-widget-toolbar` in each repository, in the runbook's order:
   - studio: scope table + test, loader import, Actions palette, `package.json`,
     `tsconfig.json` paths (lockfiles after the publish);
   - ai: scope table + test, `CONTROL_WIDGETS` and `FILTER_WIDGETS`, a routing
     row (the Widget Builder prompt hash in `test_dashboard_skills.py` moved
     with it), the filter-wiring skill;
   - platform-db, only once Studio and the AI are live: the create line in
     `install/create_init_data.sql` and `update-2.1.244.sql` (re-check the
     number against CHECKSUMS before committing);
   - website: the board-template enum, a Toolbar section in `widgets.mdx` and
     the Toolbar as a parameter source (and how its tools clear one) in
     `filters.mdx`, both in all 11 languages,
     `public/docs/media/widgets/toolbar.webp`;
   - ai-plugins: the vendored schema, `CATEGORIES`, `KNOWN_WIDGETS`,
     `widget-index.md`, `board_checks.py` (toolbar parameters count as filter
     sources; its write targets are checked), a changelog entry. On the same
     branch, the widgets skill moved from `CLAUDE.md` to `AGENTS.md`: the
     checker, the template (now with the working agreements and the
     `.claude/` and `.codex/` plugin settings), `new_widget.py` and the
     references. Catalog rebuild and a `tests/boards` regression board after
     the publish.
4. **Neighbouring widgets**: the converse `notFor` entries, uncommitted on
   branch `route-to-widget-toolbar` in widget-switch, widget-form,
   widget-filter-dropdown, widget-navbutton and widget-navbar. Release them
   only once the toolbar is registered, or the AI routes to a widget it
   cannot place.
