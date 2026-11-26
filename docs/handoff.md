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

1. **First npm publish** (Marko), per
   `deployments/docs/INTERNAL-widget-platform.md`, "Adding a new widget type",
   step 2. On the pushed `main` (clean tree, Node 24.20.0, npm ≥ 11.15):
   `npm login`, then `npm publish --access public` (no commit, no tag). Then
   `setup-trusted-publishing.sh` without `--bootstrap` for the trust rule, and
   the IronFlock repository settings (IronFlock/workflows README, "Pull
   requests from a laptop"). Later versions go through `just release-patch`.
   1.0.0 has no git tag or GitHub release; the release App creates them from
   the next release on.
2. **After the publish**: Studio's lockfiles (`npm install` and `bun install`
   in studio, npm last), and the ai-plugins catalog rebuild (it reads the
   package from jsDelivr).
3. **Platform registration**, prepared uncommitted on topic branches, in the
   runbook's order: Studio, then the AI service, then platform-db (only once
   Studio and the AI are live), then the website and ai-plugins.
4. **Neighbouring widgets**: the converse `notFor` entries, prepared on topic
   branches, ship with each widget's next release.
