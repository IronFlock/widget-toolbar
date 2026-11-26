# @ironflock/widget-toolbar

A toolbar for IronFlock apps: buttons, switches, sliders, choice groups and dropdowns
in one bar on a board. Each tool writes its value into a table column, which the app's
backend receives as a new row when it subscribes to the table, and/or sets a URL
parameter that the other widgets on the page filter on. The tools show the stored or
current value, the bar runs horizontally or as a vertical strip, and tools that do not
fit the tile move into a ⋮ menu.

A [Lit](https://lit.dev) web component for [IronFlock](https://ironflock.com) boards.

## Installation

```bash
npm i @ironflock/widget-toolbar
```

`lit` and `@material/web` are imported from the page: IronFlock Studio provides them
through its import map. The page also has to load the Roboto and Material Symbols
Outlined fonts, as Studio does.

## Usage

The package version is part of the tag name (`widget-toolbar-<version>`), so several
versions can be registered on one page. Build the tag from the version of the package
you installed, as `demo/index.html` does from `package.json`, and set the config, the
theme and the route as properties:

```js
import '@ironflock/widget-toolbar'
import pkg from '@ironflock/widget-toolbar/package.json' with { type: 'json' }

const widget = document.createElement(`widget-toolbar-${pkg.version}`)
widget.inputData = {
    tools: [
        { label: 'Live', control: 'switch', parameterKey: 'live' },
        {
            label: 'Period',
            control: 'choice',
            parameterKey: 'period',
            options: [
                { label: 'Day', value: 'day' },
                { label: 'Week', value: 'week' }
            ]
        }
    ]
}
widget.theme = { theme_name: 'light', theme_object: lightTheme }
widget.route = '/machines?period=day'
document.body.append(widget)
```

## The tools

| Tool | Shows | Writes |
| --- | --- | --- |
| `button` | a button, drawn active while its value is the current one | its Button Value on each click (`true` when empty; an empty value removes the URL parameter) |
| `switch` | an on/off switch | On Value / Off Value (default `true` / `false`; an empty Off Value removes the URL parameter) |
| `slider` | a slider with its value and unit | the number, when released |
| `choice` | the options side by side | the picked option's value |
| `dropdown` | the picked option, the others in a list | the picked option's value |
| `label`, `separator`, `spacer` | text, a line, free space | nothing |

Every interactive tool can:

- write into a column (`targetColumn`), with `extraColumns` and the toolbar's
  `sharedColumns` (such as the record id) in the same row;
- set a URL parameter (`parameterKey`);
- or both.

To show what is stored, bind the tool's `value` to the latest value of the column it
writes; after a click the tool keeps the new value for up to 10 seconds until the
binding agrees. A tool with a URL parameter shows the parameter's value. `confirmText`
asks before writing. A tool is disabled while a key column has no value.

## Events

The widget writes nothing itself. Studio handles two events:

| Event | `detail` |
| --- | --- |
| `data-submit` | `[{ swarm_app_databackend_key, table_name, column_name, value }]`: one item per column of the row; Studio groups them per table, adds `tsp` and publishes the row |
| `param-submit` | `{ params: { [key]: string \| undefined } }`: merged into the page URL; `undefined` removes the key |

## inputData

`src/definition-schema.json` describes every field. The `ToolbarConfiguration` type in
`src/definition-schema.d.ts` is generated from it with `npm run types`.
`src/default-data.json` is a working example, and it is also the config a new board
tile starts with.

## Theming

- `theme`: `{ theme_name, theme_object }`, an ECharts theme. `theme_object` can be
  missing. Its first palette colour is the default accent.
- `--re-text-color`: when this CSS custom property is set on the widget or an
  ancestor, it colours the text instead of the theme's title colour.
- `--re-tile-background-color` and `--re-background-color`: the menu and the
  confirmation dialog are painted opaque in their combination.

The widget paints no background of its own, so the board's tile shows through.

## Development

| Command | What it does |
| --- | --- |
| `npm start` | Dev server on port 8000 with the demo in `demo/index.html`, plus a watch build |
| `npm run build` | Type check, then the library build to `dist/widget-toolbar.js` |
| `npm test` | Unit tests of the tool logic and the layout |
| `npm run types` | Regenerate `src/definition-schema.d.ts` after editing `src/definition-schema.json` |
| `just release-patch` | A release pull request; its merge publishes to npm in CI and tags the version (`just merge`: a pull request that releases nothing) |
