# figma-mcp

Local bridge for driving Figma Desktop through the Plugin API: a development plugin, a relay on `127.0.0.1:3056`, and a CLI. It has no daily call limit, so prefer it over the official Figma MCP for every read, edit, and visual check.

## One-time setup (user)

1. `pnpm install`, then `pnpm build`.
2. Figma Desktop → open your design file → Plugins → Development → Import plugin from manifest… → `plugin/manifest.json`.
3. Run Plugins → Development → **Figma Bridge** and keep its window open while agents work. The window shows the relay status and the mode (`exec + ops` or `ops only`).

The plugin always connects to port 3056. Rebuild after changing anything under `plugin/`.

## Using it (agents)

```
pnpm relay                 # start once, keep running (writes .token)
node cli.ts ping                     # relay up, plugin connected, capabilities
node cli.ts info                     # file, pages, current page, selection
node cli.ts exec -e "return figma.root.name"
node cli.ts exec edit.js --timeout 120000
node cli.ts exec edit.js --args '{"page":"1:2"}'   # `args` is in scope in the script
node cli.ts export 1:23 --scale 2   # PNG written to .out/, then open it with the Read tool
node cli.ts vars --out figma-variables.json
node cli.ts ops ops.json             # fallback when exec is blocked
```

- Every command prints JSON and exits non-zero when `ok` is false.
- `exec` runs the file as the body of an async function with `figma` in scope; `return` a JSON-serializable value. Scene nodes in the result are reduced to `{ id, name, type }`.
- The file uses `documentAccess: dynamic-page`: use the async APIs (`getNodeByIdAsync`, `page.loadAsync()` before searching another page, `getLocalVariablesAsync`, `loadFontAsync` before changing text).
- Batch: put many edits in one `exec` script instead of many small calls.
- Verify visually with `export` (scale 2–3 for detail) instead of screenshots from other tools.
- One agent per page. The relay runs commands strictly in order, so parallel agents are safe only on different pages: never set `figma.currentPage`, use explicit page and node references, and keep each exec under about 60 s.
- If `ping` reports `eval: false`, the sandbox blocks dynamic code: use `ops` with a JSON array of operations — `tree`, `find`, `get`, `set`, `create`, `instance`, `clone`, `move`, `resize`, `delete`, `setText`, `bindVariable`, `setMode` (see `plugin/ops.ts` for fields).

## Layout

`scripts/layout-flow.js` lays out a page from data stored on its nodes, so a page can be re-flowed after any edit instead of being moved by hand. It is idempotent: it deletes and redraws only the nodes it generates (`Arrow/…`, `Backdrop/…`, and legacy `Flow/…`) and rebuilds the `흐름 지도` frame in place. It also sorts the layers panel (see Layers).

```
node cli.ts exec scripts/layout-flow.js --args '{"page":"1:2"}' --timeout 60000
```

args: `page` (required) · `section` (re-place frames only in that section) · `maxWidth` (row width, default 7600) · `equalizeRows` (sections in a row share the tallest height, default true) · `maxArrowLen` (default 6000) · `dry` (compute only).
Colours (variable names): `line`, `label`, `labelBg` (label pill), `blockBg` (faint background behind a main screen and its states; off by default), `sectionFill` / `sectionStroke` (1px; off by default — use when the section barely differs from the canvas), `mapBg`, `mapBox`, `mapBoxLine`, `mapHubLine`, `mapText`. Defaults are the `doc/*` grays.
Sizes: `lineWeight` (default page width / 3500, 1.5–6) · `labelSize` (default page width / 480, 14–40) · `mapScale` (flow-map size multiplier, default 1).

It returns `rows`, `page` size, `sizes`, arrow counts by type, `overlaps` (must be empty), `diff` (dry: list of moves and resizes; otherwise a count — 0 on a rerun means the page is already laid out), `noData` (frames placed without flow data), `skipped` (`next` links not drawn, with the reason) and `linkErrors`. Bad data (no numeric `step`, invalid JSON) fails with the node name and id.

Data lives in shared plugin data `getSharedPluginData('bridge', 'flow')` (JSON):

- **Section** `{ order, kind: 'main' | 'hub' | 'doc', label?, next?: [sectionId | { id, label }], breakBefore?, stateCols? }` — `order` sorts sections; the flow map mirrors the page rows (`breakBefore`): one map row per page row, boxes in section-number order, rows after the first shifted right toward the boxes they link to; `main` → `main` `next` is a straight arrow between neighbours and otherwise a lane in the gap under the row (return arrows like 검수 → 어노테이팅, or a drop to the next row like 제공 → 포털); a `hub` gets one dashed connector to its nearest target (fewest rows apart, then closest), straight when the boxes line up; each box edge hands out its own entry spots and lane levels are picked for zero crossings (any crossing or a target more than one row away is reported in `skipped`); `doc` sections stay off the map; `label` is the one-line summary in the map box; `breakBefore` starts a new row; `stateCols` (1 or 2, default 1) is how many columns a step's states use under its main screen.
- **Frame** `{ step, state, role?, next?: [frameId | { id, label }] }` — `step` is the column (flow order), `state` the row inside it (0 = main screen; states, modals and drawers below, ordered 기본 → 빈 → 로딩 → 오류 → 모달 → 드로어).

Layout rules: a main screen and its states form one block and the next main screen starts right after the block; frames narrower than 640 (modals, tray menus) pack side by side under their column; frames 120 apart and 120 from the section edge; sections 200 apart, packed left to right into rows up to `maxWidth`.

Arrows (`next` from a main screen to another main screen): consecutive columns in a section get a straight arrow; the next section in the same row gets a straight arrow from section edge to section edge at main-row height; other same-row targets route through their own lane in the gap above the row; the next row is reached through the gap right of the source section; anything longer than `maxArrowLen` or spanning 80 % of the page is skipped and reported (the flow map shows it). Labels sit on a pill just above the arrow (12 px inside a section, 16 px between sections; right of a vertical segment) and are omitted — listed in `omittedLabels` — when that spot would cover a frame or a section; the flow map carries them. Hub connectors in the map end at the target box edge nearest the hub, so two hubs never share a segment. Arrows to a `state > 0` frame are not drawn; use a prototype link for those. Prototype links (`setReactionsAsync`, ON_CLICK → NAVIGATE) are separate and stay on the buttons; `scripts/links-ui.js --args '{"page":"console"}'` (or `portal`) re-applies the UI pages' sidebar/tab/key-button links.

Run with `dry` first and read `diff`; keep a copy of the script before large changes.

## Layers

Every edit leaves the layers panel readable by a person. Check the tree, not only the PNG.

- **Connectors:** one connector is one VectorNode: a single vector network (or `figma.flatten`) with the head as a stroke cap (`ARROW_LINES`), never line pieces plus a separate head. An unlabeled connector is that vector alone, named `Arrow/<from> → <to>`; a labeled one is a group `Arrow/<from> → <to>` holding only `Connector` (the vector) and `Label`. Repeated marks that read as one shape (waveform bars, ticks of one ruler, lifelines of one diagram) are flattened into one vector named for what it shows (`Waveform`, `Lifelines`). `figma.flatten` fails on frames: copy them into rectangles first, then flatten.
- **Names:** no default names (`Frame 12`, `Rectangle`, `Vector`, `Group 5`, `Ellipse`, `Line`, `Text`, `… copy`), no empty or `null` suffixes (`Cell/`, `Button/`, `Field/null`), no numeric suffixes (`Card 2`) and no raw ids or uuids. Use roles — `Header`, `Sidebar`, `Content`, `Footer`, `Label`, `Value`, `Icon/<name>`, `Divider`, `Spacer` — or `Role/<topic>` (`Button/저장`, `Pill/완료`, `Node/API`, `Note/편집 중단`). Screen frames carry human titles (`검수 · 대기열`); sections are named `NN 제목`, numbered from 01 in reading order (main sections first, then `NN 상세 · …`).
  - **Length:** about 24 characters at most, never a sentence or a pasted value. Shorten by dropping parentheticals and keeping the first clause (`Table/역할별 홈`, not `Table/역할별 홈 (account.role)`). Identifiers that are the key itself may run longer: API paths (`Row/POST /sessions/{id}/lock`), field names, and `Arrow/<from> → <to>`.
  - **Tables:** `Table/<topic>` > `Header` + `Row/<key>` > `Cell/<column>`. A cell is named after its column header, not its value (`Cell/DB 값`, `Cell/규칙`); the row key is the first column's text (for a method column, method + path). A first column without a header is `Cell/구분`. Text inside a cell is `Value` (`Head` in the header).
  - **Text layers:** a text whose name would be longer than about 24 characters gets a role name — `Title`, `Body`, `Label` (diagram labels), `Value`, `Caption`, `Item`, `Code` (monospace) — or its prefix role (`Heading`).
  - **Siblings:** one level uses one pattern and one language for the role part: diagram boxes `Node/<label>`, sequence actors `Actor/<name>`, ERD `Domain/<group>` > `Entity/<table>` and `Note/<topic>` > `Item/<topic>`, FK lines `FK/<table.column>`. Repeated shapes with one style (ERD row stripes) are flattened into one vector (`Stripes`).
  - **Exception:** frames placed directly in a section show their name on the canvas as the block title, so they keep their human title even when it is longer.
- **Hierarchy:** Section > screen > slot > element. No wrappers: a group or frame with one child, no fill, stroke, effect, reaction or plugin data, and the child's exact bounds is removed and the child takes its place and sizing. Table cells (`Cell/…`) keep their name when unwrapped. Lane, slot and track frames that define a size are not wrappers.
- **Empty layers:** delete empty text and empty slots; when the parent hugs, fix its size first so nothing moves. `Spacer` frames in auto layout and alignment placeholders (`Slot/Dot`, `Track/Label`, an empty `Cell/<column>`) may stay.
- **Order:** the panel reads top to bottom in visual order. Flow pages: frames by step and state, then arrows, then backdrops; on the page the flow map, page-level arrows (above the sections they enter), then sections in order. Other pages: arrows, then sections row by row and column by column. Inside free (non-auto-layout) frames, reorder only when no two children overlap, so z-order never changes what you see.
- **Hidden layers:** delete them unless they sit inside an instance or are bound to a component property (`componentPropertyReferences.visible`).
- **Component internals:** renaming layers inside a main component is safe (overrides follow node ids). Never replace a layer that instances override: merge an icon's pieces in place (`setVectorNetworkAsync` on the first piece with the others' networks offset into it, then delete the others) so the survivor keeps its overrides, and only when every instance overrides all pieces alike. Hidden layers that keep variants in step (a hidden `Label` or `Selection indicator` in some variants) stay.
- **Verify:** export the page at 0.5× before and after and pixel-compare (`node cli.ts exec scripts/page-slice.js --args '{"page":"<id>","pad":40}'` makes a temporary slice; `export <slice id> --scale 0.5`; then exec it again with `{"page":"<id>","remove":"<slice id>"}`; compare with `node scripts/pixdiff.mjs before.png after.png`, which uses `sips`); only arrows and intended fixes may differ.

`scripts/clean-layers.js` does the generic part per step (`hidden`, `empty`, `unwrap`, `names`, `wave` = flatten repeated bars, `order`); run each with `"dry":true` first and read the samples. It was written for the Wireframe page; check its rules against the page before running it elsewhere.

Names that scripts look up — keep them stable or change the script in the same edit:

- `layout-flow.js`: generated prefixes `Arrow/`, `Backdrop/`, legacy `Flow/` (deleted on rerun — never give hand-made layers these prefixes as direct children of a section or page); the map frame `흐름 지도`. Sections and frames are found by flow plugin data, not names.

## Safety

- The relay binds to 127.0.0.1 only, rejects other Host headers and browser origins, and requires the token in `.token` for every CLI request. `.token` and `.out/` stay in this folder.
- Never put secrets in scripts. Scripts change the user's design file — export and check before large deletions.

## Checks

`pnpm test`, `pnpm typecheck`, `pnpm build`.

## Recovery (macOS)

If `ping` shows `plugin: false`, relaunch the plugin with `osascript relaunch.applescript`, wait about 8 s, and ping again. The target file must be the front Figma window; check `file.name` in `ping`.
