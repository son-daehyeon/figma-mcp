// Re-runnable flow layout for a page. Usage:
//   node cli.ts exec scripts/layout-flow.js --args '{"page":"1:2"}' --timeout 60000
// args (all optional except page) — see AGENTS.md "Layout":
//   section · maxWidth (7600) · equalizeRows (true) · maxArrowLen (6000) · dry
//   colours: line · label · labelBg · blockBg · sectionFill · sectionStroke · mapBg · mapBox · mapBoxLine · mapHubLine · mapText
//   sizes: lineWeight (page width / 3500, 1.5–6) · labelSize (page width / 480, 14–40) · mapScale (1)
// section data may set stateCols (1 or 2): a step's states wrap into that many columns under its main screen.
// section data may set alignLoneStates: a column with no main screen starts its states one main-row down (the previous column's main height), so a lone alt-mode frame sits in the alt row.
const PAD = 120, GAP = 120, SECTION_GAP = 200, LANE = 24, GUTTER = 80, GUTTER_STEP = 32, SMALL = 640, MAP = '흐름 지도'
const MAX_ROW = args.maxWidth ?? 7600
const DRY = !!args.dry, EQUALIZE = args.equalizeRows ?? true, MAX_LEN = args.maxArrowLen ?? 6000
const page = await figma.getNodeByIdAsync(args.page)
await page.loadAsync()
const colors = {}
for (const v of await figma.variables.getLocalVariablesAsync('COLOR')) colors[v.name] = v
const resolved = {}
async function resolve(v) {
  const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId)
  const val = v.valuesByMode[col.defaultModeId]
  return val && val.type === 'VARIABLE_ALIAS' ? resolve(await figma.variables.getVariableByIdAsync(val.id)) : val
}
const C = {
  line: args.line ?? 'doc/gray-550', label: args.label ?? 'doc/gray-650', labelBg: args.labelBg ?? args.mapBg ?? 'doc/white',
  blockBg: args.blockBg, sectionFill: args.sectionFill, sectionStroke: args.sectionStroke,
  mapBg: args.mapBg ?? 'doc/white', box: args.mapBox ?? 'doc/gray-50', boxLine: args.mapBoxLine ?? 'doc/gray-150',
  hubLine: args.mapHubLine ?? 'doc/gray-300', boxText: args.mapText ?? 'doc/gray-850',
}
for (const name of Object.values(C).filter(Boolean)) { if (!colors[name]) throw new Error(`variable not found: ${name}`); resolved[name] = await resolve(colors[name]) }
const color = name => {
  const { r, g, b, a = 1 } = resolved[name]
  return figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r, g, b }, opacity: a }, 'color', colors[name])
}
const font = { family: 'Noto Sans KR', style: 'Regular' }, fontBold = { family: 'Noto Sans KR', style: 'Medium' }
await figma.loadFontAsync(font)
await figma.loadFontAsync(fontBold)

const diff = [], noData = [], skipped = [], linkErrors = [], omitted = []
const read = n => {
  const s = n.getSharedPluginData('bridge', 'flow')
  if (!s) return null
  try { return JSON.parse(s) } catch { throw new Error(`flow data is not JSON on ${n.name} (${n.id})`) }
}
const readFrame = f => {
  const d = read(f)
  if (d && !Number.isFinite(d.step)) throw new Error(`flow data on ${f.name} (${f.id}) needs a numeric step`)
  if (d && d.state !== undefined && !Number.isFinite(d.state)) throw new Error(`flow data on ${f.name} (${f.id}) has a non-numeric state`)
  return d
}
const nexts = d => (d?.next ?? []).map(x => typeof x === 'string' ? { id: x } : x)
const sections = page.children.filter(n => n.type === 'SECTION')
const order = s => read(s)?.order ?? 1e6 + page.children.indexOf(s)
sections.sort((a, b) => order(a) - order(b))

const plan = new Map()
const nx = n => plan.get(n.id)?.x ?? n.x, ny = n => plan.get(n.id)?.y ?? n.y
const nw = n => plan.get(n.id)?.w ?? Math.round(n.width), nh = n => plan.get(n.id)?.h ?? Math.round(n.height)
const orig = new Map()
const short = n => n.name.replace(/^(Console|Portal) · /, '')
const remember = n => { if (!orig.has(n.id)) orig.set(n.id, { name: n.name, x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.width), h: Math.round(n.height) }) }
function move(n, x, y) {
  remember(n)
  plan.set(n.id, { ...plan.get(n.id), x, y })
  if (!DRY) { n.x = x; n.y = y }
}
function size(n, w, h) {
  remember(n)
  plan.set(n.id, { ...plan.get(n.id), w, h })
  if (!DRY) n.resizeWithoutConstraints(w, h)
}

const GENERATED = /^(Flow|Arrow|Backdrop)\//
if (!DRY) {
  for (const s of sections) for (const n of [...s.children]) if (GENERATED.test(n.name)) n.remove()
  for (const n of [...page.children]) if (GENERATED.test(n.name)) n.remove()
}

const place = new Map(), blocks = []
const Wd = c => Math.round(c.f.width), Ht = c => Math.round(c.f.height)
for (const s of sections) {
  if (!DRY && C.sectionFill) s.fills = [color(C.sectionFill)]
  if (!DRY && C.sectionStroke) { s.strokes = [color(C.sectionStroke)]; s.strokeWeight = 1 }
  const frames = s.children.filter(n => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(n.type) && !GENERATED.test(n.name))
  const known = frames.filter(readFrame)
  if (!known.length && frames.length) noData.push(`${s.name}: no frame has flow data`)
  if (!known.length || (args.section && args.section !== s.id)) {
    for (const f of frames) place.set(f.id, { s, f, d: readFrame(f) })
    continue
  }
  let extra = Math.max(...known.map(f => readFrame(f).step)) + 1
  const cols = new Map()
  for (const f of [...frames].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let d = readFrame(f)
    if (!d) { d = { step: extra++, state: 0 }; noData.push(`${s.name} / ${f.name} (${f.id})`) }
    if (!cols.has(d.step)) cols.set(d.step, [])
    cols.get(d.step).push({ f, d })
  }
  const stateCols = Math.min(2, Math.max(1, read(s)?.stateCols ?? 1))
  const alignLone = !!read(s)?.alignLoneStates
  let x = PAD, bottom = PAD, lastMainH = 0
  for (const step of [...cols.keys()].sort((a, b) => a - b)) {
    const col = cols.get(step).sort((a, b) => (a.d.state ?? 0) - (b.d.state ?? 0))
    for (const c of col) place.set(c.f.id, { s, f: c.f, d: c.d })
    const cw = Math.max(...col.map(Wd))
    let head, rest, B, y
    if (stateCols === 1) { head = []; rest = col; B = cw; y = alignLone && lastMainH && (col[0].d.state ?? 0) !== 0 ? PAD + lastMainH + GAP : PAD }
    else {
      head = col.filter(c => (c.d.state ?? 0) === 0); rest = col.filter(c => (c.d.state ?? 0) !== 0)
      if (!head.length) head = [rest.shift()]
      const headW = head.reduce((t, c) => t + Wd(c) + GAP, -GAP)
      B = Math.max(headW, rest.filter(c => Wd(c) >= SMALL).length > 1 ? 2 * cw + GAP : cw)
      head.reduce((hx, c) => { move(c.f, hx, PAD); return hx + Wd(c) + GAP }, x)
      y = PAD + Math.max(...head.map(Ht)) + GAP
    }
    let rx = x, rh = 0, right = x + (head.length ? head.reduce((t, c) => t + Wd(c) + GAP, -GAP) : 0)
    for (const c of rest) {
      if (rx > x && rx + Wd(c) > x + B) { y += rh + GAP; rx = x; rh = 0 }
      move(c.f, rx, y)
      right = Math.max(right, rx + Wd(c))
      rx += Wd(c) + GAP
      rh = Math.max(rh, Ht(c))
    }
    const blockBottom = rest.length ? y + rh : PAD + Math.max(...head.map(Ht))
    if (rest.length && col.length > 1) blocks.push({ s, x, y: PAD, w: right - x, h: blockBottom - PAD, name: short(col[0].f) })
    bottom = Math.max(bottom, blockBottom)
    if ((col[0].d.state ?? 0) === 0) lastMainH = Ht(col[0])
    x = right + GAP
  }
  size(s, x - GAP + PAD, bottom + PAD)
}
if (!DRY && C.blockBg) for (const b of blocks) {
  const r = figma.createRectangle()
  b.s.insertChild(0, r)
  r.name = `Backdrop/${b.name}`
  r.x = b.x - 40; r.y = b.y - 40
  r.resize(b.w + 80, b.h + 80)
  r.cornerRadius = 24
  r.fills = [color(C.blockBg)]
}

const rows = []
for (const s of sections) {
  const last = rows[rows.length - 1]
  const w = nw(s)
  if (last && !read(s)?.breakBefore && last.w + SECTION_GAP + w <= MAX_ROW) { last.items.push(s); last.w += SECTION_GAP + w }
  else rows.push({ items: [s], w })
}

let map = page.children.find(n => n.name === MAP && n.type === 'FRAME')
const mapItems = sections.map(s => ({ s, d: read(s) })).filter(x => x.d && x.d.kind !== 'doc')
if (mapItems.length && !DRY) { map = await drawMap(map, mapItems, rows); if (args.mapScale && args.mapScale !== 1) map.rescale(args.mapScale) }
if (EQUALIZE) for (const r of rows) {
  const h = Math.max(...r.items.map(nh))
  for (const s of r.items) if (nh(s) !== h) size(s, nw(s), h)
}
let cursor = 0
if (map) { move(map, 0, 0); cursor = Math.round(map.height) + SECTION_GAP }
const rowOf = new Map(), colOf = new Map()
rows.forEach((r, i) => {
  let x = 0
  r.top = cursor
  r.items.forEach((s, j) => { move(s, x, cursor); x += nw(s) + SECTION_GAP; rowOf.set(s.id, i); colOf.set(s.id, j) })
  r.bottom = cursor + Math.max(...r.items.map(nh))
  cursor = r.bottom + SECTION_GAP
})
const pageW = Math.max(...rows.map(r => r.w))
const LW = args.lineWeight ?? Math.min(6, Math.max(1.5, Math.round(pageW / 3500 * 2) / 2))
const LABEL = args.labelSize ?? Math.min(40, Math.max(14, Math.round(pageW / 480)))

const absX = f => nx(f.parent) + nx(f), absY = f => ny(f.parent) + ny(f)
const mains = new Map()
for (const e of place.values()) if (e.d && (e.d.state ?? 0) === 0) { if (!mains.has(e.s.id)) mains.set(e.s.id, []); mains.get(e.s.id).push(e) }
for (const list of mains.values()) list.sort((p, q) => p.d.step - q.d.step)
const firstMain = s => mains.get(s.id)?.[0]?.f, lastMain = s => mains.get(s.id)?.at(-1)?.f
const arrows = { straight: [], adjacent: [], band: [], cross: [], gutter: [] }
for (const { s, f, d } of place.values()) {
  if (!d || (d.state ?? 0) !== 0) continue
  for (const n of nexts(d)) {
    const t = place.get(n.id)
    if (!t) { skipped.push({ from: f.name, to: n.id, reason: 'target not in a section on this page' }); continue }
    if (!t.d || (t.d.state ?? 0) !== 0) { skipped.push({ from: f.name, to: t.f.name, reason: 'target is not a main screen (state 0)' }); continue }
    const a = { from: f, to: t.f, label: n.label, s, ts: t.s, row: rowOf.get(s.id), trow: rowOf.get(t.s.id) }
    if (t.s === s && t.d.step === d.step + 1) { arrows.straight.push(a); continue }
    if (t.s !== s && a.row === a.trow && colOf.get(t.s.id) === colOf.get(s.id) + 1 && t.f === firstMain(t.s)) {
      const st = lastMain(s)
      const y1 = Math.max(absY(st), absY(t.f)), y2 = Math.min(absY(st) + st.height, absY(t.f) + t.f.height)
      if (y2 > y1) { a.y = Math.round((y1 + y2) / 2); arrows.adjacent.push(a); continue }
    }
    if (a.row === a.trow) arrows.band.push(a)
    else if (a.trow === a.row + 1) arrows.cross.push(a)
    else arrows.gutter.push(a)
  }
}

const cx = f => absX(f) + f.width / 2, laneY = row => rows[row].top - 24
const estimate = {
  band: a => { const span = Math.abs(cx(a.from) - cx(a.to)); return { span, len: span + (absY(a.from) - laneY(a.row)) + (absY(a.to) - laneY(a.row)) } },
  cross: a => {
    const st = lastMain(a.s), x1 = absX(st) + st.width, sy = absY(st) + st.height / 2, gx = nx(a.s) + nw(a.s) + SECTION_GAP / 2, inY = laneY(a.trow)
    return { span: Math.max(gx, x1, cx(a.to)) - Math.min(gx, x1, cx(a.to)), len: (gx - x1) + (inY - sy) + Math.abs(gx - cx(a.to)) + (absY(a.to) - inY) }
  },
  gutter: a => {
    const outY = laneY(a.row), inY = laneY(a.trow)
    return { span: Math.max(cx(a.from), cx(a.to)) + GUTTER, len: (absY(a.from) - outY) + cx(a.from) + GUTTER + Math.abs(inY - outY) + cx(a.to) + GUTTER + Math.abs(absY(a.to) - inY) }
  },
}
for (const kind of ['band', 'cross', 'gutter']) arrows[kind] = arrows[kind].filter(a => {
  const { span, len } = estimate[kind](a)
  if (len <= MAX_LEN && span < 0.8 * pageW) return true
  skipped.push({ from: a.from.name, to: a.to.name, reason: `too long — flow map shows it (${Math.round(len)} px, span ${Math.round(span)})` })
  return false
})

const ends = new Map()
const addEnd = (f, a, side) => { if (!ends.has(f.id)) ends.set(f.id, []); ends.get(f.id).push({ a, side }) }
for (const a of arrows.gutter) { addEnd(a.from, a, 'out'); addEnd(a.to, a, 'in') }
for (const a of arrows.cross) addEnd(a.to, a, 'in')
for (const a of arrows.band) { addEnd(a.from, a, 'bout'); addEnd(a.to, a, 'bin') }
for (const [id, list] of ends) {
  const f = place.get(id).f
  const rank = { bin: 0, in: 1, out: 1, bout: 2 }
  list.sort((p, q) => rank[p.side] - rank[q.side])
  list.forEach((e, i) => { e.a[e.side + 'X'] = Math.round(absX(f) + f.width * (i + 1) / (list.length + 1)) })
}
const pillH = Math.round(LABEL * 1.45 + LABEL * 0.6)
const gaps = new Map()
const useGap = (row, key, a, slot) => { if (!gaps.has(row)) gaps.set(row, []); gaps.get(row).push({ key, a, slot }) }
for (const a of arrows.gutter) { useGap(a.row, a.outX, a, 'outY'); useGap(a.trow, a.inX, a, 'inY') }
for (const a of arrows.cross) useGap(a.trow, 1e9 + a.inX, a, 'inY')
for (const a of arrows.band) useGap(a.row, Math.max(a.boutX, a.binX), a, 'bandY')
for (const [row, list] of gaps) {
  const top = row === 0 ? rows[0].top - SECTION_GAP : rows[row - 1].bottom
  const step = Math.min(Math.max(LANE, pillH + 8), Math.floor((rows[row].top - top - 48) / list.length))
  list.sort((p, q) => p.key - q.key).forEach((e, k) => { e.a[e.slot] = rows[row].top - 24 - step * k })
}
arrows.gutter.sort((p, q) => Math.abs(p.row - p.trow) - Math.abs(q.row - q.trow) || p.outX - q.outX).forEach((a, i) => { a.gx = -(GUTTER + GUTTER_STEP * i) })
const crossBySection = new Map()
for (const a of arrows.cross) {
  const k = crossBySection.get(a.s.id) ?? 0
  crossBySection.set(a.s.id, k + 1)
  a.start = lastMain(a.s)
  a.sy = Math.round(absY(a.start) + a.start.height / 2) + k * LANE
  a.gx = nx(a.s) + nw(a.s) + SECTION_GAP / 2 + k * GUTTER_STEP
}

if (!DRY) {
  const opt = { weight: LW, size: LABEL }
  const sectionRects = [...sections, ...(map ? [map] : [])].map(n => ({ x: nx(n), y: ny(n), w: n === map ? n.width : nw(n), h: n === map ? n.height : nh(n) }))
  const frameRects = s => s.children.filter(n => !GENERATED.test(n.name)).map(n => ({ x: n.x, y: n.y, w: n.width, h: n.height }))
  const lbl = (a, gap, avoid) => a.label && { text: a.label, gap, avoid, name: `${short(a.from)} → ${short(a.to)}` }
  for (const a of arrows.straight) {
    const y = Math.round(a.from.y + Math.min(a.from.height, a.to.height) / 2)
    const x1 = a.from.x + a.from.width, x2 = a.to.x
    await line(a.s, `Arrow/${short(a.from)} → ${short(a.to)}`, [[x1, y], [x2, y]], lbl(a, 12, frameRects(a.s)), opt)
  }
  for (const a of arrows.adjacent) {
    const x1 = nx(a.s) + nw(a.s), x2 = nx(a.ts)
    await line(page, `Arrow/${short(a.from)} → ${short(a.to)}`, [[x1, a.y], [x2, a.y]], lbl(a, 16, sectionRects), opt)
  }
  for (const a of arrows.band) {
    const pts = [[a.boutX, absY(a.from)], [a.boutX, a.bandY], [a.binX, a.bandY], [a.binX, absY(a.to)]]
    await line(page, `Arrow/${short(a.from)} → ${short(a.to)}`, pts, lbl(a, 16, sectionRects), opt)
  }
  for (const a of arrows.cross) {
    const x1 = absX(a.start) + a.start.width
    const pts = [[x1, a.sy], [a.gx, a.sy], [a.gx, a.inY], [a.inX, a.inY], [a.inX, absY(a.to)]]
    await line(page, `Arrow/${short(a.from)} → ${short(a.to)}`, pts, lbl(a, 16, sectionRects), opt)
  }
  for (const a of arrows.gutter) {
    const pts = [[a.outX, absY(a.from)], [a.outX, a.outY], [a.gx, a.outY], [a.gx, a.inY], [a.inX, a.inY], [a.inX, absY(a.to)]]
    await line(page, `Arrow/${short(a.from)} → ${short(a.to)}`, pts, lbl(a, 16, sectionRects), opt)
  }
}

// Layers panel reads top to bottom in flow order: frames by step and state, then arrows, then backdrops;
// on the page the flow map, then page-level arrows (they enter sections, so they stay above them), then sections in order.
if (!DRY) {
  const flowKey = n => { const d = place.get(n.id)?.d; return d ? [d.step, d.state ?? 0] : null }
  const byFlow = (a, b) => {
    const p = flowKey(a), q = flowKey(b)
    if (p && q) return p[0] - q[0] || p[1] - q[1] || a.y - b.y || a.x - b.x
    return p ? -1 : q ? 1 : a.y - b.y || a.x - b.x
  }
  const stack = (parent, panel) => { for (const n of [...panel].reverse()) parent.appendChild(n) }
  for (const s of sections) {
    const kids = [...s.children]
    stack(s, [...kids.filter(n => !GENERATED.test(n.name)).sort(byFlow), ...kids.filter(n => n.name.startsWith('Arrow/')), ...kids.filter(n => n.name.startsWith('Backdrop/'))])
  }
  const top = [...page.children], rest = top.filter(n => n !== map && !sections.includes(n))
  stack(page, [...(map ? [map] : []), ...rest.filter(n => n.name.startsWith('Arrow/')), ...sections, ...rest.filter(n => !n.name.startsWith('Arrow/'))])
}

function midpoint(pts) {
  const lens = pts.slice(1).map((p, i) => Math.abs(p[0] - pts[i][0]) + Math.abs(p[1] - pts[i][1]))
  let half = lens.reduce((a, b) => a + b, 0) / 2
  for (let i = 0; i < lens.length; i++) {
    if (half <= lens[i]) { const t = lens[i] ? half / lens[i] : 0; return [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1]), pts[i][1] === pts[i + 1][1]] }
    half -= lens[i]
  }
  return [...pts.at(-1), true]
}

async function pill(parent, text, size) {
  const t = figma.createText()
  t.fontName = font; t.fontSize = size; t.characters = text
  t.lineHeight = { value: Math.round(size * 1.45), unit: 'PIXELS' }
  t.fills = [color(C.label)]
  t.textAutoResize = 'NONE'
  t.resize(Math.ceil(t.width), Math.round(size * 1.45))
  const f = figma.createFrame()
  parent.appendChild(f)
  f.name = 'Label'
  f.layoutMode = 'HORIZONTAL'
  f.primaryAxisSizingMode = 'AUTO'
  f.counterAxisSizingMode = 'AUTO'
  f.paddingLeft = f.paddingRight = Math.round(size * 0.6)
  f.paddingTop = f.paddingBottom = Math.round(size * 0.3)
  f.fills = [color(C.labelBg)]
  f.strokes = [color(C.line)]
  f.strokeWeight = Math.max(1, Math.round(size / 20))
  f.appendChild(t)
  f.cornerRadius = Math.round(f.height / 2)
  return f
}

async function placeLabel(parent, label, pts, size) {
  const f = await pill(parent, label.text, size)
  const w = f.width, h = f.height
  let x, y
  if (label.x !== undefined) { x = label.x - w / 2; y = label.y - h / 2 }
  else {
    const [px, py, horizontal] = midpoint(pts)
    const gap = label.gap ?? 16
    if (horizontal) { x = px - w / 2; y = py - gap - h } else { x = px + gap; y = py - h / 2 }
  }
  f.x = Math.round(x); f.y = Math.round(y)
  const r = { x: f.x, y: f.y, w, h }
  if ((label.avoid ?? []).some(b => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h)) {
    f.remove()
    omitted.push(label.name ?? label.text)
    return null
  }
  return f
}

async function line(parent, name, pts, label, { dashed = false, weight = 1.5, size = 12 } = {}) {
  const v = figma.createVector()
  parent.appendChild(v)
  const minX = Math.min(...pts.map(p => p[0])), minY = Math.min(...pts.map(p => p[1]))
  v.x = Math.round(minX); v.y = Math.round(minY)
  await v.setVectorNetworkAsync({
    vertices: pts.map((p, i) => ({ x: Math.round(p[0] - minX), y: Math.round(p[1] - minY), strokeCap: i === pts.length - 1 ? 'ARROW_LINES' : 'NONE', cornerRadius: 8 })),
    segments: pts.slice(1).map((_, i) => ({ start: i, end: i + 1 })),
    regions: [],
  })
  v.strokes = [color(C.line)]
  v.strokeWeight = weight
  v.strokeJoin = 'ROUND'
  if (dashed) v.dashPattern = [6, 4]
  const p = label && await placeLabel(parent, label, pts, size)
  if (!p) { v.name = name; return v }
  v.name = 'Connector'
  const g = figma.group([v, p], parent)
  g.name = name
  return g
}

async function drawMap(existing, items, pageRows) {
  const f = existing ?? figma.createFrame()
  if (!existing) { page.appendChild(f); f.name = MAP }
  for (const c of [...f.children]) c.remove()
  f.layoutMode = 'NONE'
  f.fills = [color(C.mapBg)]
  f.cornerRadius = 12
  f.clipsContent = false
  const W = 280, H = 88, H_GAP = 80, P = Math.round(120 / (args.mapScale ?? 1)), ROW_GAP = 96, LANE = 40, LANE_PAD = 48, SPOT = 24
  const isHub = x => x.d.kind === 'hub'
  const byId = new Map(items.map(x => [x.s.id, x]))
  const nameOf = id => byId.get(id)?.s.name ?? id
  // map rows mirror the page rows (breakBefore); inside a row, section-number order
  const mrows = pageRows.map(r => r.items.map(s => byId.get(s.id)).filter(Boolean)).filter(r => r.length)
  const pos = new Map()
  const cx = id => pos.get(id).x + W / 2
  const linked = (it, r) => [...nexts(it.d).map(n => n.id), ...items.filter(o => nexts(o.d).some(n => n.id === it.s.id)).map(o => o.s.id)].filter(id => pos.has(id) && pos.get(id).row < r)
  mrows.forEach((row, r) => {
    let right = P - H_GAP
    for (const it of row) {
      const ids = linked(it, r)
      const want = ids.length ? Math.round(ids.reduce((a, id) => a + cx(id), 0) / ids.length - W / 2) : P
      const x = Math.max(right + H_GAP, want)
      pos.set(it.s.id, { x, row: r }); right = x + W
    }
  })
  const edges = []
  for (const it of items) {
    if (isHub(it)) continue
    for (const n of nexts(it.d)) {
      const t = byId.get(n.id)
      if (!t || !pos.has(t.s.id)) { skipped.push({ from: it.s.name, to: n.id, reason: 'map: target is not a main or hub section on this page' }); continue }
      if (!isHub(t)) edges.push({ a: it, b: t, label: n.label })
    }
  }
  for (const h of items.filter(isHub)) {
    const ts = nexts(h.d).map(n => byId.get(n.id)).filter(t => t && !isHub(t) && pos.has(t.s.id))
    if (!ts.length) { if (nexts(h.d).length) skipped.push({ from: h.s.name, to: nexts(h.d).map(n => n.id).join(','), reason: 'map: hub targets are not main sections' }); continue }
    const hr = pos.get(h.s.id).row, hx = cx(h.s.id)
    const cost = t => Math.abs(pos.get(t.s.id).row - hr) * 1e6 + Math.abs(cx(t.s.id) - hx)
    edges.push({ a: h, b: ts.reduce((m, t) => cost(t) < cost(m) ? t : m), dashed: true })
  }
  // each box edge hands out spots so two connectors never share a segment
  const used = new Map()
  const spot = (id, side, near) => {
    const p = pos.get(id), key = `${id}:${side}`, taken = used.get(key) ?? []
    const xs = Array.from({ length: Math.floor((W - 2 * SPOT) / 8) + 1 }, (_, i) => p.x + SPOT + i * 8)
    const x = xs.filter(x => taken.every(t => Math.abs(t - x) >= SPOT)).sort((u, v) => Math.abs(u - near) - Math.abs(v - near))[0] ?? Math.round(p.x + W / 2)
    used.set(key, [...taken, x]); return x
  }
  const channels = new Map()
  for (const e of edges) {
    const A = pos.get(e.a.s.id), B = pos.get(e.b.s.id)
    if (A.row === B.row && B.x === A.x + W + H_GAP) { e.kind = 'adjacent'; continue }
    if (Math.abs(A.row - B.row) > 1) { skipped.push({ from: e.a.s.name, to: e.b.s.name, reason: 'map: target is more than one map row away' }); e.kind = 'skip'; continue }
    // a channel is the gap under map row `ch`; upper ends sit on that row's bottom edges
    const ch = Math.min(A.row, B.row)
    if (A.row === B.row) { e.kind = 'loop'; e.ux = [spot(e.a.s.id, 'b', cx(e.a.s.id)), spot(e.b.s.id, 'b', cx(e.b.s.id))] }
    else {
      const [up, lo] = A.row < B.row ? [e.a, e.b] : [e.b, e.a]
      const u = pos.get(up.s.id), l = pos.get(lo.s.id), lc = cx(lo.s.id)
      const straight = lc >= u.x + SPOT && lc <= u.x + W - SPOT && !(used.get(`${up.s.id}:b`) ?? []).some(t => Math.abs(t - lc) < SPOT)
      e.kind = A.row < B.row ? 'down' : 'up'
      e.ux = [straight ? lc : spot(up.s.id, 'b', lc)]
      if (straight) used.set(`${up.s.id}:b`, [...(used.get(`${up.s.id}:b`) ?? []), lc])
      e.lx = straight ? lc : spot(lo.s.id, 't', e.ux[0])
      e.straight = straight
    }
    e.ch = ch
    if (!channels.has(ch)) channels.set(ch, [])
    channels.get(ch).push(e)
  }
  // lane levels per channel: fewest crossings, never two overlapping horizontals on one level
  let crossings = 0
  const span = e => e.kind === 'loop' ? [Math.min(...e.ux), Math.max(...e.ux)] : [Math.min(e.ux[0], e.lx), Math.max(e.ux[0], e.lx)]
  const verts = e => e.kind === 'loop' ? e.ux.map(x => ({ x, up: true })) : [{ x: e.ux[0], up: true }, { x: e.lx, up: false }]
  const hits = (e, le, o, lo) => verts(o).filter(v => { const [x1, x2] = span(e); return v.x > x1 && v.x < x2 && (v.up ? le < lo : le > lo) }).length
  for (const list of channels.values()) {
    const lanes = list.filter(e => !e.straight).sort((u, v) => (span(u)[1] - span(u)[0]) - (span(v)[1] - span(v)[0]))
    const done = []
    for (const e of lanes) {
      let best = null
      for (let lv = 0; lv <= done.length; lv++) {
        const clash = done.some(o => o.level === lv && span(o)[0] < span(e)[1] + 16 && span(e)[0] < span(o)[1] + 16)
        if (clash) continue
        const c = done.reduce((t, o) => t + hits(e, lv, o, o.level) + hits(o, o.level, e, lv), 0) + list.filter(o => o.straight).reduce((t, o) => t + (o.lx > span(e)[0] && o.lx < span(e)[1] ? 1 : 0), 0)
        if (!best || c < best.c) best = { lv, c }
      }
      e.level = best.lv; crossings += best.c; done.push(e)
    }
    list.levels = done.length ? Math.max(...done.map(e => e.level)) + 1 : 0
  }
  if (crossings) skipped.push({ from: 'flow map', to: '', reason: `map: ${crossings} connector crossing(s)` })
  const rowY = [P]
  for (let r = 1; r < mrows.length; r++) {
    const lv = channels.get(r - 1)?.levels ?? 0
    rowY[r] = rowY[r - 1] + H + Math.max(ROW_GAP, lv ? 2 * LANE_PAD + (lv - 1) * LANE : 0)
  }
  for (const [id, p] of pos) p.y = rowY[p.row]
  for (const it of items) {
    const p = pos.get(it.s.id), hub = isHub(it)
    if (!p) continue
    const box = figma.createFrame()
    f.appendChild(box)
    box.name = it.s.name
    box.layoutMode = 'VERTICAL'
    box.primaryAxisAlignItems = 'CENTER'
    box.counterAxisAlignItems = 'CENTER'
    box.itemSpacing = 4
    box.resize(W, H)
    box.primaryAxisSizingMode = 'FIXED'
    box.counterAxisSizingMode = 'FIXED'
    box.cornerRadius = 8
    box.fills = [color(hub ? C.mapBg : C.box)]
    box.strokes = [color(hub ? C.hubLine : C.boxLine)]
    box.strokeWeight = 1
    if (hub) box.dashPattern = [6, 4]
    box.x = p.x; box.y = p.y
    const t = figma.createText()
    box.appendChild(t)
    t.fontName = fontBold; t.fontSize = 20; t.lineHeight = { value: 28, unit: 'PIXELS' }; t.characters = it.s.name
    t.fills = [color(C.boxText)]
    try { t.hyperlink = { type: 'NODE', value: it.s.id } } catch (e) { linkErrors.push(`${it.s.name}: ${e.message}`) }
    t.name = 'Name'
    t.textAlignHorizontal = 'CENTER'; t.layoutSizingHorizontal = 'FILL'
    if (it.d.label) {
      const sub = figma.createText()
      box.appendChild(sub)
      sub.fontName = font; sub.fontSize = 14; sub.lineHeight = { value: 20, unit: 'PIXELS' }; sub.characters = it.d.label
      sub.fills = [color(C.label)]
      sub.name = 'Summary'
      sub.textAlignHorizontal = 'CENTER'; sub.layoutSizingHorizontal = 'FILL'
    }
  }
  for (const e of edges) {
    if (e.kind === 'skip') continue
    const A = pos.get(e.a.s.id), B = pos.get(e.b.s.id), name = `Arrow/${e.a.s.name} → ${nameOf(e.b.s.id)}`
    const opts = e.dashed ? { dashed: true } : { size: 14 }
    const top = r => rowY[r], bot = r => rowY[r] + H
    let pts, label = e.label && { text: e.label }
    if (e.kind === 'adjacent') {
      pts = [[A.x + W, A.y + H / 2], [B.x, B.y + H / 2]]
      if (label) label = { text: e.label, x: A.x + W + H_GAP / 2, y: A.y - 20 }
    } else {
      const ly = bot(e.ch) + LANE_PAD + (e.level ?? 0) * LANE
      if (e.kind === 'loop') pts = [[e.ux[0], bot(e.ch)], [e.ux[0], ly], [e.ux[1], ly], [e.ux[1], bot(e.ch)]]
      else if (e.straight) pts = e.kind === 'down' ? [[e.lx, bot(e.ch)], [e.lx, top(e.ch + 1)]] : [[e.lx, top(e.ch + 1)], [e.lx, bot(e.ch)]]
      else if (e.kind === 'down') pts = [[e.ux[0], bot(e.ch)], [e.ux[0], ly], [e.lx, ly], [e.lx, top(e.ch + 1)]]
      else pts = [[e.lx, top(e.ch + 1)], [e.lx, ly], [e.ux[0], ly], [e.ux[0], bot(e.ch)]]
    }
    await line(f, name, pts, label, opts)
  }
  const isArrow = c => c.name.startsWith('Arrow/')
  for (const c of [...f.children.filter(c => !isArrow(c)), ...f.children.filter(isArrow)].reverse()) f.appendChild(c)
  const right = Math.max(...f.children.map(c => c.x + c.width)), bottom = Math.max(...f.children.map(c => c.y + c.height))
  f.resize(Math.ceil(right) + P, Math.ceil(bottom) + P)
  return f
}

const boxes = [...(map ? [map] : []), ...sections].map(n => ({ name: n.name, x: nx(n), y: ny(n), w: n === map ? n.width : nw(n), h: n === map ? n.height : nh(n) }))
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const overlaps = []
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) overlaps.push([boxes[i].name, boxes[j].name])
for (const s of sections) {
  const fs = s.children.filter(n => !GENERATED.test(n.name)).map(n => ({ name: n.name, x: nx(n), y: ny(n), w: n.width, h: n.height }))
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) if (hit(fs[i], fs[j])) overlaps.push([s.name, fs[i].name, fs[j].name])
}
for (const [id, o] of orig) {
  const p = plan.get(id)
  if (p.x !== undefined && (p.x !== o.x || p.y !== o.y)) diff.push({ name: o.name, id, from: [o.x, o.y], to: [p.x, p.y] })
  if (p.w !== undefined && (p.w !== o.w || p.h !== o.h)) diff.push({ name: o.name, id, size: [o.w, o.h], to: [p.w, p.h] })
}
const bounds = boxes.reduce((b, n) => ({ w: Math.max(b.w, n.x + n.w), h: Math.max(b.h, n.y + n.h) }), { w: 0, h: 0 })
return {
  rows: rows.map(r => r.items.map(s => s.name).join(' | ')),
  page: `${Math.round(bounds.w)}x${Math.round(bounds.h)}`,
  sizes: { lineWeight: LW, labelSize: LABEL },
  arrows: Object.fromEntries(Object.entries(arrows).map(([k, v]) => [k, v.length])),
  overlaps,
  diff: DRY ? diff : diff.length,
  noData,
  skipped,
  omittedLabels: omitted,
  linkErrors,
}
